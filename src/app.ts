import axios, { AxiosRequestConfig } from "axios";
import dotenv from "dotenv";
import express, { NextFunction } from "express";
import lowdb from "lowdb";
import queryString from "query-string";
import { v4 as uuid } from "uuid";

import { TokenResponse, SIGNED_COOKIE_ACCESS_TOKEN, COOKIE_RETURN_URL, SIGNED_COOKIE_REFRESH_TOKEN, SIGNED_COOKIE_EXPIRE_REFRESH, SIGNED_COOKIE_STATE, UserObjectPrivate, COOKIE_USER_ID, SIGNED_COOKIE_EXPIRE_LOGOUT, DbUser, PagingObject, PlaylistSimplified, DbPlaylist, PlaylistTrack, TrackObjectFull, MESSAGE_NEVER_UPDATED, MESSAGE_VARIOUS_ARTISTS, MESSAGE_LAST_UPDATED_PREFIX, DbPlaylistSimplified, PlaylistFull, ArtistObjectSimplified, ArtistObjectFull, TrackObjectSimplified, AlbumObjectSimplified, DbArtist, AlbumObjectFull, TrackWithAlbum, AlbumType, TracksToAdd } from "./defines";

export interface DbState {
    users: DbUser[];
    playlists: DbPlaylist[];
    artists: DbArtist[];
}
export type DbType = lowdb.LowdbAsync<DbState>;

// Make sure the environment variables are loaded before exporting this class
dotenv.config();

export class App {

    //#region Config

    //#region Constants

    //#region Spotify-determined

    private static readonly playlistsToGetPerRequest = 50;
    private static readonly tracksToGetPerRequest = 100;
    private static readonly albumsToGetPerRequest = 20;
    private static readonly tracksToAddPerRequest = 100;

    //#endregion

    private static readonly playlistsExpireAfterNDays = 1;
    private static readonly tracksExpireAfterNDays = 7;
    private static readonly mainArtistThreshold = 0.75;

    //#endregion

    //#region Environment

    public static readonly port = +process.env.PORT;
    public static readonly hostUrl = process.env.HOST_URL || `http://localhost:${App.port}`;
    private static readonly spotifyAuthParams = {
        // eslint-disable-next-line @typescript-eslint/camelcase
        client_id: process.env.CLIENT_ID,
        // eslint-disable-next-line @typescript-eslint/camelcase
        redirect_uri: `${App.hostUrl}/callback`,
        scope: process.env.SCOPE
    };
    private static readonly spotifyClientSecret = process.env.CLIENT_SECRET;
    private static readonly spotifyBasicAuth = Buffer.from(`${App.spotifyAuthParams.client_id}:${App.spotifyClientSecret}`).toString("base64");
    public static readonly cookieSecret = process.env.COOKIE_SECRET;

    //#endregion

    //#endregion

    private readonly db: DbType;
    public readonly router: express.Router;

    public constructor(db: DbType) {
        this.db = db;
        this.router = express.Router();
        this.configureRoutes();
    }

    private configureRoutes(): void {
        this.router.get("/", App.handleAsync(this.routeIndex.bind(this)));
        this.router.get("/callback", App.handleAsync(this.routeCallback.bind(this)));
        this.router.get("/create", App.handleAsync(this.routeCreate.bind(this)));
        this.router.get("/login", this.routeLogin.bind(this));
        this.router.get("/logout", this.routeLogout.bind(this));
        this.router.get("/playlist", this.routePlaylistWithoutID.bind(this));
        this.router.get("/playlist/:playlistID", App.handleAsync(this.routePlaylist.bind(this)));
        this.router.get("/playlist/:playlistID/latest", App.handleAsync(this.routePlaylistLatest.bind(this)));
        this.router.get("/playlist/:playlistID/tracks", this.routePlaylistTracksWithoutPage.bind(this));
        this.router.get("/playlist/:playlistID/tracks/:page", App.handleAsync(this.routePlaylistTracks.bind(this)));
        this.router.post("/playlist/:playlistID/update", App.handleAsync(this.routePlaylistUpdate.bind(this)));
        this.router.get("/playlists", this.routePlaylistsWithoutPage.bind(this));
        this.router.get("/playlists/:page", App.handleAsync(this.routePlaylists.bind(this)));
        this.router.get("/refresh", App.handleAsync(this.routeRefresh.bind(this)));
        this.router.get("/refresh/:playlistID", App.handleAsync(this.routeRefreshPlaylist.bind(this)));
        this.router.get("/remove-personal-info", App.handleAsync(this.routeRemovePersonalInfo.bind(this)));
        this.router.get("/settings", App.handleAsync(this.routeSettings.bind(this)));
    }

    //#region Routes

    private async routeIndex(req: express.Request, res: express.Response): Promise<void> {
        // Logged in?
        if (req.signedCookies[SIGNED_COOKIE_ACCESS_TOKEN]) {
            if (!(await this.checkCredentials(req, res)))
                res.redirect("/playlists");
        }
        else
            res.render("pages/index", { loggedIn: false });
    }

    private async routeCallback(req: express.Request, res: express.Response): Promise<void> {
        let error = req.query.error as string;
        if (!error && req.signedCookies[SIGNED_COOKIE_STATE] !== req.query.state)
            error = "State does not match";
        res.clearCookie(SIGNED_COOKIE_STATE, { signed: true });
        if (!error && !req.query.code)
            error = "Did not receive a code";

        if (error) {
            // TODO: Render an actual error page...
            res.status(404).send(`Unable to login: ${error}`);
            return;
        }

        // Get the authentication token
        try {
            await this.getToken(res, {
                // eslint-disable-next-line @typescript-eslint/camelcase
                grant_type: "authorization_code",
                code: req.query.code as string,
                // eslint-disable-next-line @typescript-eslint/camelcase
                redirect_uri: App.spotifyAuthParams.redirect_uri
            });
        } catch (e) {
            // TODO: Show an error page
            res.status(404).send(e);
            return;
        }

        // Redirect the user
        if (req.cookies[COOKIE_RETURN_URL]) {
            const returnUrl = req.cookies[COOKIE_RETURN_URL];
            res.clearCookie(COOKIE_RETURN_URL)
                .redirect(returnUrl);
        } else
            res.redirect("/");
    }

    private async routeCreate(req: express.Request, res: express.Response): Promise<void> {
        if (await this.checkCredentials(req, res))
            return;

        res.render("pages/create", {
            loggedIn: true,
            userID: req.cookies[COOKIE_USER_ID] as string
        });
    }

    private routeLogin(req: express.Request, res: express.Response): void {
        // Create a new state
        const state = uuid();
        res.cookie(SIGNED_COOKIE_STATE, state, { signed: true });

        // Redirect to Spotify for authorization
        const params = queryString.stringify({
            // eslint-disable-next-line @typescript-eslint/camelcase
            response_type: "code",
            ...App.spotifyAuthParams,
            state
        });
        res.redirect(`https://accounts.spotify.com/authorize?${params}`);
    }

    private routeLogout(req: express.Request, res: express.Response): void {
        // Clear all the cookies
        Object.keys(req.cookies)
            .filter(key => typeof req.cookies[key] === "string")
            .forEach(key => res.clearCookie(key));
        Object.keys(req.signedCookies)
            .filter(key => typeof req.signedCookies[key] === "string")
            .forEach(key => res.clearCookie(key, { signed: true }));

        // Render the results
        res.render("pages/logout", { loggedIn: false });
    }

    private routePlaylistWithoutID(req: express.Request, res: express.Response): void {
        res.redirect("/playlists");
    }

    private async routePlaylist(req: express.Request, res: express.Response): Promise<void> {
        if (await this.checkCredentials(req, res))
            return;

        // Get the playlist info
        const id: string = req.params.playlistID;
        const playlist = this.db.get("playlists").find(p => p.id === id).value();

        // Get the main artist, if any
        let mainArtist: ArtistObjectSimplified = null;
        if (playlist.mainArtist)
            mainArtist = this.db.get("artists").find(artist => artist.id === playlist.mainArtist).get("info").value();

        // Render the page
        res.render("pages/playlist", {
            loggedIn: true,
            playlist,
            mainArtist
        });
    }

    private async routePlaylistLatest(req: express.Request, res: express.Response): Promise<void> {
        // No need to verify login, will throw an error during the request to Spotify

        // Parse the request params
        const id: string = req.params.playlistID;
        const accessToken: string = req.signedCookies[SIGNED_COOKIE_ACCESS_TOKEN];
        const requestParams: AxiosRequestConfig = {
            headers: {
                "Authorization": `Bearer ${accessToken}`
            }
        };

        // Get the playlist info
        const dbPlaylist = this.db.get("playlists").find(p => p.id === id);
        let playlist = dbPlaylist.value();

        // Error message
        let mainArtistError = "Could not identify main artist. Unable to find new tracks.";

        // Main artist identified?
        if (!playlist.variousArtists && !playlist.mainArtist) {
            // Search the first page of songs
            await this.ensureTracksForPage(id, 1, accessToken);
            playlist = dbPlaylist.value();

            // Attempt to identify the main artist
            let mainArtist: string;
            type artistEntry = { info: ArtistObjectSimplified; count: number };
            const artistsFound = new Map<string, artistEntry>();
            for (const track of playlist.cache)
                for (const artist of track.artists) {
                    // Increment the count for this artist
                    let entry: artistEntry;
                    if (artistsFound.has(artist.id))
                        entry = artistsFound.get(artist.id);
                    else
                        entry = {
                            info: artist,
                            count: 0
                        };
                    entry.count++;
                    artistsFound.set(artist.id, entry);

                    // Name matches the playlist?
                    if (artist.name.toLowerCase() === playlist.info.name.toLowerCase())
                        mainArtist = artist.id;
                }

            // Main artist found?
            if (mainArtist) {
                // Ensure the percentage is above some threshold
                const entry = artistsFound.get(mainArtist);
                if (entry.count < App.mainArtistThreshold * playlist.cache.length) {
                    // Not good enough
                    mainArtist = null;
                    mainArtistError = `Main artist does not appear in at least ${App.mainArtistThreshold * 100}% of the tracks. Unable to properly identify.`;
                }
            } else if (artistsFound.size) {
                // Take the artist that occurred the most within the playlist
                const entries: artistEntry[] = [];
                artistsFound.forEach(entry => entries.push(entry));
                const mainArtistEntry = entries.sort((a, b) => b.count - a.count)[0];
                if (mainArtistEntry.count > App.mainArtistThreshold * playlist.cache.length)
                    mainArtist = mainArtistEntry.info.id;
                else
                    mainArtistError = "Playlist appears to contain multiple artists. Please ensure there are enough tracks by the desired artist.";
            } else
                mainArtistError = "Unable to identify main artist. Please ensure the playlist already contains tracks by the desired artist.";

            // Main artist found?
            if (mainArtist) {
                // Get the full artist info (mainly for their image)
                const info = await App.axiosGet<ArtistObjectFull>(`https://api.spotify.com/v1/artists/${mainArtist}`, requestParams);

                // Update the DB
                const dbArtists = this.db.get("artists");
                const dbArtist = dbArtists.find(artist => artist.id === mainArtist);
                if (dbArtist.isUndefined().value())
                    await dbArtists.push({ id: mainArtist, info }).write();
                else
                    await dbArtist.set("info", info).write();

                // Ensure all tracks are loaded
                await this.ensureTracksForPage(id, -1, accessToken);
                playlist = dbPlaylist.value();

                // Find the date of the last track that was added
                let lastUpdated = playlist.lastUpdated;
                for (const track of playlist.cache) {
                    // Local tracks don't support this property...
                    if (track.is_local || !track.album || !track.album.release_date)
                        continue;

                    const parts = track.album.release_date.split("-");
                    let date: Date;
                    if (parts.length === 0)
                        continue;
                    else if (parts.length === 1)
                        date = new Date(+parts[0], 1);
                    else if (parts.length === 2)
                        date = new Date(+parts[0], +parts[1] - 1);
                    else
                        date = new Date(+parts[0], +parts[1] - 1, +parts[2] - 1);

                    if (lastUpdated.getTime() < date.getTime())
                        lastUpdated = date;
                }
                await dbPlaylist.set("lastUpdated", lastUpdated)
                    .set("mainArtist", mainArtist)
                    .set("updatedMessage", `${MESSAGE_LAST_UPDATED_PREFIX} ${App.dateString(lastUpdated)}`)
                    .write();

                // Notify the caller the main artist was found
                res.setHeader("X-Initial-Update", "true");
            } else
                // Update the DB
                await dbPlaylist.set("updatedMessage", MESSAGE_VARIOUS_ARTISTS)
                    .set("variousArtists", true)
                    .write();

            // Pull the DB values
            playlist = dbPlaylist.value();
        }
        if (playlist.variousArtists) {
            res.status(404).send(mainArtistError);
            return;
        }

        // Get the latest albums for the selected artist
        const dateArtistWasChecked = new Date();
        const newAlbumIDs: string[] = [];
        const artistParams = queryString.stringify({
            // eslint-disable-next-line @typescript-eslint/camelcase
            include_groups: "album,single",
            limit: 50,
            offset: 0
        });
        let artistUrl = `https://api.spotify.com/v1/artists/${playlist.mainArtist}/albums?${artistParams}`;
        while (artistUrl) {
            const albums = await App.axiosGet<PagingObject<AlbumObjectSimplified>>(artistUrl, requestParams);
            newAlbumIDs.push(...albums.items.map(album => album.id));
            artistUrl = albums.next;
        }

        // Convert to albums
        let newAlbums: AlbumObjectFull[] = [];
        for (let i = 0; i < newAlbumIDs.length; i += App.albumsToGetPerRequest) {
            const params = queryString.stringify({
                ids: newAlbumIDs.slice(i, i + App.albumsToGetPerRequest).join(",")
            });
            const albumUrl = `https://api.spotify.com/v1/albums?${params}`;
            const albums = await App.axiosGet<{ albums: AlbumObjectFull[] }>(albumUrl, requestParams);
            newAlbums.push(...albums.albums);
        }

        // Sort the albums
        newAlbums = newAlbums.sort((a, b) => {
            const aParts = a.release_date.split("-");
            const bParts = b.release_date.split("-");

            const aYear = aParts.length >= 0 ? +aParts[0] : -1;
            const bYear = bParts.length >= 0 ? +bParts[0] : -1;
            if (aYear !== bYear)
                return aYear - bYear;

            const aMonth = aParts.length >= 1 ? +aParts[1] : -1;
            const bMonth = bParts.length >= 1 ? +bParts[1] : -1;
            if (aMonth !== bMonth)
                return aMonth - bMonth;

            const aDay = aParts.length >= 1 ? +aParts[1] : -1;
            const bDay = bParts.length >= 1 ? +bParts[1] : -1;
            if (aDay !== bDay)
                return aDay - bDay;

            if (a.album_type !== b.album_type)
                return a.album_type === AlbumType.single ? -1 : 1;
            else
                return 0;
        });

        // Get rid of albums older than the last check date
        newAlbums = newAlbums.filter(album => {
            const parts = album.release_date.split("-");
            if (parts.length === 0)
                return false;

            const year = +parts[0];
            if (year !== playlist.lastUpdated.getFullYear())
                return year > playlist.lastUpdated.getFullYear();
            if (parts.length === 1)
                return true;

            const month = +parts[1] - 1;
            if (month !== playlist.lastUpdated.getMonth())
                return month > playlist.lastUpdated.getMonth();
            if (parts.length === 2)
                return true;

            const day = +parts[2] - 1;
            if (day !== playlist.lastUpdated.getDay())
                return day > playlist.lastUpdated.getDay();
            return true;
        });

        // Convert to tracks
        let newTracks: TrackWithAlbum[] = [];
        for (const album of newAlbums) {
            // Take the existing tracks
            const albumTracks: TrackObjectSimplified[] = [];
            albumTracks.push(...album.tracks.items);

            // Get the rest
            let trackUrl = album.tracks.next;
            while (trackUrl) {
                const tracks = await App.axiosGet<PagingObject<TrackObjectSimplified>>(trackUrl, requestParams);
                albumTracks.push(...tracks.items);
                trackUrl = tracks.next;
            }

            // Add to the list
            newTracks.push(...albumTracks.map(track => ({ ...track, album } as TrackWithAlbum)));
        }

        // Ensure all tracks are loaded
        await this.ensureTracksForPage(id, -1, accessToken);
        playlist = dbPlaylist.value();

        // Remove any already present in the playlist
        const currentTracks = new Set<string>();
        for (const track of playlist.cache)
            currentTracks.add(track.id);
        newTracks = newTracks.filter(track => !currentTracks.has(track.id));

        // TODO: Handle singles vs albums, etc.

        // Render the results
        if (newTracks.length)
            res.render("stubs/new_tracks", { newTracks, dateArtistWasChecked, formatLength: App.formatLength });
        else {
            await dbPlaylist.set("lastCached", dateArtistWasChecked)
                .set("updatedMessage", `${MESSAGE_LAST_UPDATED_PREFIX} ${App.dateString(dateArtistWasChecked)}`)
                .write();
            res.header("X-No-Tracks", "true").send("No new tracks found.");
        }
    }

    private routePlaylistTracksWithoutPage(req: express.Request, res: express.Response): void {
        res.redirect(`/playlist/${req.params.playlistID}/tracks/1`);
    }

    private async routePlaylistTracks(req: express.Request, res: express.Response): Promise<void> {
        if (await this.checkCredentials(req, res))
            return;

        // Invalid page number?
        const id: string = req.params.playlistID;
        const page: number = +req.params.page;
        if (isNaN(page) || page <= 0) {
            res.redirect(`/playlist/${id}/tracks/1`);
            return;
        }

        // Ensure the page is downloaded
        await this.ensureTracksForPage(id, page, req.signedCookies[SIGNED_COOKIE_ACCESS_TOKEN]);

        // Page number too large?
        const dbPlaylist = this.db.get("playlists").find(p => p.id === id);
        const totalPlaylistCount = dbPlaylist.get("count").value();
        const maxPage = Math.max(1, Math.ceil(totalPlaylistCount / App.tracksToGetPerRequest));
        if (page > maxPage) {
            res.redirect(`/playlist/${id}/tracks/${maxPage}`);
            return;
        }

        // Get the tracks for this page
        const tracks = dbPlaylist.get("cache").value().slice((page - 1) * App.tracksToGetPerRequest, page * App.tracksToGetPerRequest);

        // Get the playlist
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { cache, ...playlistSimplified } = dbPlaylist.value();
        const modelPlaylist: DbPlaylistSimplified = { ...playlistSimplified };

        // Render the results
        res.render("pages/tracks", {
            loggedIn: true,
            paginationRootUrl: `/playlist/${id}/tracks`,
            page,
            maxPage,
            tracks,
            playlist: modelPlaylist,
            formatLength: App.formatLength
        });
    }

    private async routePlaylistUpdate(req: express.Request, res: express.Response): Promise<void> {
        // No need to verify login, will throw an error during the request to Spotify

        // Validate the params
        const id: string = req.params.playlistID;
        const tracksToAdd: TracksToAdd = req.body;

        const accessToken: string = req.signedCookies[SIGNED_COOKIE_ACCESS_TOKEN];
        try {
            // Append the tracks to the playlist
            for (let i = 0; i < tracksToAdd.trackURIs.length; i += App.tracksToAddPerRequest)
                await App.axiosPost(
                    `https://api.spotify.com/v1/playlists/${id}/tracks`,
                    {
                        uris: tracksToAdd.trackURIs.slice(i, i + App.tracksToAddPerRequest)
                    },
                    {
                        headers: {
                            "Authorization": `Bearer ${accessToken}`,
                            "Content-Type": "application/json"
                        }
                    }
                );

            // Update the DB
            await this.db.get("playlists").find(playlist => playlist.id === id)
                .set("lastUpdated", tracksToAdd.dateArtistWasChecked)
                .set("updatedMessage", `${MESSAGE_LAST_UPDATED_PREFIX} ${App.dateString(tracksToAdd.dateArtistWasChecked)}`)
                .write();
        } finally {
            // Get the latest playlist info
            await this.refreshPlaylist(id, accessToken);
        }

        // All good
        res.send("");
    }

    private routePlaylistsWithoutPage(req: express.Request, res: express.Response): void {
        res.redirect("/playlists/1");
    }

    private async routePlaylists(req: express.Request, res: express.Response): Promise<void> {
        if (await this.checkCredentials(req, res))
            return;

        // Invalid page number?
        const page: number = +req.params.page;
        if (isNaN(page) || page <= 0) {
            res.redirect("/playlists/1");
            return;
        }

        // Ensure the page is downloaded
        const id: string = req.cookies[COOKIE_USER_ID];
        await this.ensurePlaylistsForPage(id, page, req.signedCookies[SIGNED_COOKIE_ACCESS_TOKEN]);

        // Page number too large?
        const dbUserPlaylists = this.db.get("users").find(user => user.id === id).get("playlists");
        const totalPlaylistCount = dbUserPlaylists.get("count").value();
        const maxPage = Math.max(1, Math.ceil(totalPlaylistCount / App.playlistsToGetPerRequest));
        if (page > maxPage) {
            res.redirect(`/playlists/${maxPage}`);
            return;
        }

        // Get the playlists for this page
        const playlistIDs = dbUserPlaylists.get("cache").value().slice((page - 1) * App.playlistsToGetPerRequest, page * App.playlistsToGetPerRequest);
        const dbPlaylists = this.db.get("playlists");
        const playlistModels: DbPlaylistSimplified[] = [];
        for (const playlistID of playlistIDs) {
            const playlist = dbPlaylists.find(p => p.id === playlistID).value();
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { cache, ...playlistSimplified } = playlist;
            playlistModels.push({
                ...playlistSimplified
            });
        }

        // Render the results
        res.render("pages/playlists", {
            loggedIn: true,
            paginationRootUrl: "/playlists",
            page,
            maxPage,
            playlists: playlistModels
        });
    }

    private async routeRefresh(req: express.Request, res: express.Response): Promise<void> {
        // Clear the cached playlists
        const id: string = req.cookies[COOKIE_USER_ID];
        await this.db.get("users").find(user => user.id === id).get("playlists")
            .set("cache", [])
            .set("count", -1)
            .set("lastCached", new Date(0))
            .write();

        // Clear the cached tracks
        const dbPlaylists = this.db.get("playlists");
        for (const playlist of dbPlaylists.filter(p => p.userID === id).value())
            await dbPlaylists.find(p => p.id === playlist.id)
                .set("cache", [])
                .set("count", -1)
                .set("lastCached", new Date(0))
                .write();

        res.send("");
    }

    private async routeRefreshPlaylist(req: express.Request, res: express.Response): Promise<void> {
        // Refresh the playlist
        const id: string = req.params.playlistID;
        const accessToken: string = req.signedCookies[SIGNED_COOKIE_ACCESS_TOKEN];
        await this.refreshPlaylist(id, accessToken);

        res.send("");
    }

    private async routeRemovePersonalInfo(req: express.Request, res: express.Response): Promise<void> {
        if (await this.checkCredentials(req, res))
            return;

        // Clear the user's data from the database
        const userID: string = req.cookies[COOKIE_USER_ID];
        await this.db.get("users").remove(user => user.id === userID).write();
        await this.db.get("playlists").remove(playlist => playlist.userID === userID).write();

        // Clear all the cookies
        Object.keys(req.cookies)
            .filter(key => typeof req.cookies[key] === "string")
            .forEach(key => res.clearCookie(key));
        Object.keys(req.signedCookies)
            .filter(key => typeof req.signedCookies[key] === "string")
            .forEach(key => res.clearCookie(key, { signed: true }));

        // Render the results
        res.render("pages/remove-personal-info", { loggedIn: false });
    }

    private async routeSettings(req: express.Request, res: express.Response): Promise<void> {
        if (await this.checkCredentials(req, res))
            return;

        res.render("pages/settings", { loggedIn: true });
    }

    //#endregion

    //#region Helpers

    //#region Axios

    private static async axiosGet<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
        const response = await axios.get(url, config);
        return response.data;
    }

    private static async axiosPost<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
        const response = await axios.post(url, data, config);
        return response.data;
    }

    //#endregion

    //#region Date

    private static readonly daySuffix = "th";
    private static readonly daySuffixes = [App.daySuffix, "st", "nd", "rd"];
    private static readonly monthsOfTheYear = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    private static addDays(date: Date, n: number): Date {
        const result = new Date(date);
        result.setDate(result.getDate() + n);
        return result;
    }
    private static addSeconds(date: Date, n: number): Date {
        const result = new Date(date);
        result.setSeconds(result.getSeconds() + n);
        return result;
    }
    private static dateString(date: Date): string {
        const dayOfTheMonth = date.getDate();
        const suffix = (dayOfTheMonth % 10) < App.daySuffixes.length ? App.daySuffixes[dayOfTheMonth % 10] : App.daySuffix;
        return `${App.monthsOfTheYear[date.getMonth()]} ${dayOfTheMonth}${suffix}, ${date.getFullYear()} at ${App.twoDigits(date.getHours())}:${App.twoDigits(date.getMinutes())}`;
    }
    private static twoDigits(n: number): string {
        if (n < 10)
            return `0${n}`;
        return `${n}`;
    }

    //#endregion

    //#region Misc

    private static formatLength(value: number): string {
        if (!value || value < 0)
            return "0:00";

        value = Math.floor(value / 1000);
        if (value < 60)
            return `0:${value < 10 ? "0" : ""}${value}`;

        const seconds = value % 60;
        value = Math.floor(value / 60);
        if (value < 60)
            return `${value}:${seconds < 10 ? "0" : ""}${seconds}`;

        const minutes = value % 60;
        value = Math.floor(value / 60);
        return `${value}:${minutes < 10 ? "0" : ""}${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
    }

    //#endregion

    //#region Routes

    private static handleAsync(cb: (req: express.Request, res: express.Response, next: NextFunction) => Promise<unknown>) {
        return (req: express.Request, res: express.Response, next: NextFunction): Promise<unknown> => cb(req, res, next).catch(next);
    }

    //#endregion

    //#region Spotify

    private async checkCredentials(req: express.Request, res: express.Response): Promise<boolean> {
        // Not logged in?
        const oldUrl = req.originalUrl;
        const accessToken: string = req.signedCookies[SIGNED_COOKIE_ACCESS_TOKEN];
        if (!accessToken) {
            res.cookie(COOKIE_RETURN_URL, oldUrl)
                .redirect("/login");
            return true;
        }

        try {
            // Login expired?
            const now = new Date();
            const logoutDate = new Date(req.signedCookies[SIGNED_COOKIE_EXPIRE_LOGOUT]);
            if (!logoutDate || logoutDate <= now)
                throw new Error("Login session expired");

            // Login requires refresh?
            const refreshDate = new Date(req.signedCookies[SIGNED_COOKIE_EXPIRE_REFRESH]);
            const refreshToken: string = req.signedCookies[SIGNED_COOKIE_REFRESH_TOKEN];
            if (!refreshDate || !refreshToken)
                throw new Error("Login session expired");
            if (refreshDate <= now)
                await this.getToken(res, {
                    // eslint-disable-next-line @typescript-eslint/camelcase
                    grant_type: "refresh_token",
                    // eslint-disable-next-line @typescript-eslint/camelcase
                    refresh_token: refreshToken
                });

            // Can continue as normal
            return false;
        } catch {
            res.cookie(COOKIE_RETURN_URL, oldUrl)
                .redirect("/logout");
            return true;
        }
    }

    private async ensurePlaylistsForPage(id: string, page: number, accessToken: string): Promise<void> {
        // Cache some DB values
        const dbUser = this.db.get("users").find(user => user.id === id);
        const dbUserPlaylists = dbUser.get("playlists");
        let maxCount = dbUserPlaylists.get("count").value();

        // Perform hard refresh?
        let cachedSize: number;
        if (maxCount < 0 || App.addDays(dbUserPlaylists.get("lastCached").value(), App.playlistsExpireAfterNDays) <= new Date()) {
            cachedSize = 0;
            await dbUserPlaylists.set("cache", [])
                .set("count", 0)
                .set("lastCached", new Date())
                .write();
        } else {
            // Already have the data?
            cachedSize = dbUserPlaylists.get("cache").size().value();
            let hasData: boolean;
            if (page <= 0)
                hasData = maxCount <= cachedSize;
            else if (maxCount > 0) {
                hasData = cachedSize > (page - 1) * App.playlistsToGetPerRequest;
                if (hasData && cachedSize < maxCount)
                    hasData = (page + 1) * App.playlistsToGetPerRequest > maxCount;
            } else
                hasData = true;
            if (hasData)
                return;
        }

        // List of playlists being added
        const addedPlaylists: PlaylistSimplified[] = [];

        // Need to get first page?
        let lastPage = Math.ceil(cachedSize / App.playlistsToGetPerRequest);
        if (lastPage <= 1) {
            // Get the first page
            const params = queryString.stringify({
                limit: App.playlistsToGetPerRequest,
                offset: 0
            });
            const playlists = await App.axiosGet<PagingObject<PlaylistSimplified>>(`https://api.spotify.com/v1/me/playlists?${params}`, {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            });

            // Clear the existing playlists
            await dbUserPlaylists.set("cache", []).write();

            // Append to the playlists
            addedPlaylists.splice(addedPlaylists.length, 0, ...playlists.items);

            // Update the max count
            maxCount = playlists.total;
            await dbUserPlaylists.set("count", maxCount).write();

            // Got the first page
            lastPage = 1;
        }

        // Get the remaining pages
        if (page <= 0)
            page = 1000000;
        page = Math.min(page, Math.ceil(maxCount / App.playlistsToGetPerRequest));
        for (; lastPage < page; lastPage++) {
            // Get the page
            const params = queryString.stringify({
                limit: App.playlistsToGetPerRequest,
                offset: lastPage * App.playlistsToGetPerRequest
            });
            const playlists = await App.axiosGet<PagingObject<PlaylistSimplified>>(`https://api.spotify.com/v1/me/playlists?${params}`, {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            });

            // Append to the playlists
            addedPlaylists.splice(addedPlaylists.length, 0, ...playlists.items);
        }

        // Nothing to add?
        if (!addedPlaylists.length)
            return;

        // Add everything to the cache
        await dbUserPlaylists.get("cache").push(...addedPlaylists.map(p => p.id)).write();

        // Ensure the playlists are up-to-date
        const dbPlaylists = this.db.get("playlists");
        for (const playlist of addedPlaylists) {
            const dbPlaylist = dbPlaylists.find(p => p.id === playlist.id);
            if (dbPlaylist.isUndefined().value() === true)
                await dbPlaylists.push({
                    cache: [],
                    count: -1,
                    id: playlist.id,
                    info: playlist,
                    mainArtist: null,
                    lastCached: new Date(0),
                    lastUpdated: new Date(0),
                    updatedMessage: MESSAGE_NEVER_UPDATED,
                    userID: id,
                    variousArtists: false
                }).write();
            else {
                // Update the latest playlist info (mainly for the image links)
                await dbPlaylist.set("info", playlist).write();

                // Count was changed?
                const count = dbPlaylist.get("count").value();
                if (count < 0 || count !== playlist.tracks.total)
                    // Playlist has been updated, clear the existing cached values
                    await dbPlaylist.set("cache", [])
                        .set("count", playlist.tracks.total)
                        .set("lastCached", new Date(0))
                        .write();
            }
        }
    }

    private async ensureTracksForPage(id: string, page: number, accessToken: string): Promise<void> {
        // Cache some DB values
        const dbPlaylist = this.db.get("playlists").find(playlist => playlist.id === id);
        let maxCount = dbPlaylist.get("count").value();

        // Perform hard refresh?
        let cachedSize: number;
        if (maxCount < 0 || App.addDays(dbPlaylist.get("lastCached").value(), App.tracksExpireAfterNDays) <= new Date()) {
            cachedSize = 0;
            await dbPlaylist.set("cache", [])
                .set("count", 0)
                .set("lastCached", new Date())
                .write();
        } else {
            // Already have the data?
            cachedSize = dbPlaylist.get("cache").size().value();
            let hasData: boolean;
            if (page <= 0)
                hasData = maxCount <= cachedSize;
            else if (maxCount > 0) {
                hasData = cachedSize > (page - 1) * App.tracksToGetPerRequest;
                if (hasData && cachedSize < maxCount)
                    hasData = (page + 1) * App.tracksToGetPerRequest > maxCount;
            } else
                hasData = true;
            if (hasData)
                return;
        }

        // List of tracks being added
        const addedTracks: PlaylistTrack[] = [];

        // Need to get first page?
        let lastPage = Math.ceil(cachedSize / App.tracksToGetPerRequest);
        if (lastPage <= 1) {
            // Get the first page
            const params = queryString.stringify({
                limit: App.tracksToGetPerRequest,
                offset: 0
            });
            const tracks = await App.axiosGet<PagingObject<PlaylistTrack>>(`https://api.spotify.com/v1/playlists/${id}/tracks?${params}`, {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            });

            // Clear the existing tracks
            await dbPlaylist.set("cache", []).write();

            // Append to the tracks
            addedTracks.splice(addedTracks.length, 0, ...tracks.items);

            // Update the max count
            maxCount = tracks.total;
            await dbPlaylist.set("count", maxCount).write();

            // Got the first page
            lastPage = 1;
        }

        // Get the remaining pages
        if (page <= 0)
            page = 1000000;
        page = Math.min(page, Math.ceil(maxCount / App.tracksToGetPerRequest));
        for (; lastPage < page; lastPage++) {
            // Get the page
            const params = queryString.stringify({
                limit: App.tracksToGetPerRequest,
                offset: lastPage * App.tracksToGetPerRequest
            });
            const tracks = await App.axiosGet<PagingObject<PlaylistTrack>>(`https://api.spotify.com/v1/playlists/${id}/tracks?${params}`, {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            });

            // Append to the tracks
            addedTracks.splice(addedTracks.length, 0, ...tracks.items);
        }

        // Nothing to add?
        if (!addedTracks.length)
            return;

        // Add everything to the cache
        await dbPlaylist.get("cache").push(...(addedTracks.map(track => track.track as TrackObjectFull))).write();
    }

    private async getToken(res: express.Response, data: { grant_type: "authorization_code"; code: string; redirect_uri: string } | { grant_type: "refresh_token"; refresh_token: string }): Promise<void> {
        const tokenResp = await App.axiosPost<TokenResponse>("https://accounts.spotify.com/api/token", queryString.stringify(data), {
            headers: {
                Authorization: `Basic ${App.spotifyBasicAuth}`,
                "Content-Type": "application/x-www-form-urlencoded"
            }
        });

        res.cookie(SIGNED_COOKIE_ACCESS_TOKEN, tokenResp.access_token, { signed: true });
        if (tokenResp.refresh_token)
            res.cookie(SIGNED_COOKIE_REFRESH_TOKEN, tokenResp.refresh_token, { signed: true });
        res.cookie(SIGNED_COOKIE_EXPIRE_REFRESH, App.addSeconds(new Date(), Math.floor(tokenResp.expires_in * 0.5)).toString(), { signed: true });
        res.cookie(SIGNED_COOKIE_EXPIRE_LOGOUT, App.addSeconds(new Date(), Math.floor(tokenResp.expires_in * 0.99)).toString(), { signed: true });

        // Get the current user's info
        const userResp = await App.axiosGet<UserObjectPrivate>("https://api.spotify.com/v1/me", {
            headers: {
                Authorization: `Bearer ${tokenResp.access_token}`
            }
        });

        res.cookie(COOKIE_USER_ID, userResp.id);

        // Initialize DB entry
        const dbUsers = this.db.get("users");
        const dbUser = dbUsers.find(user => user.id === userResp.id);
        if (dbUser.isUndefined().value() === true)
            await dbUsers.push({
                id: userResp.id,
                info: userResp,
                playlists: {
                    cache: [],
                    count: -1,
                    lastCached: new Date(0)
                }
            }).write();
        else
            // Update the user info (mostly for the image)
            await dbUser.set("info", userResp).write();

        // Ensure the playlist count is kept up to date
        await this.ensurePlaylistsForPage(userResp.id, 1, tokenResp.access_token);
    }

    private async refreshPlaylist(id: string, accessToken: string): Promise<void> {
        // Clear the cached tracks
        const dbPlaylist = this.db.get("playlists").find(playlist => playlist.id === id);
        await dbPlaylist.set("cache", [])
            .set("count", -1)
            .set("lastCached", new Date(0))
            .write();

        // Get the latest playlist info
        const info = await App.axiosGet<PlaylistFull>(`https://api.spotify.com/v1/playlists/${id}`, {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        });
        await dbPlaylist.set("info", info).write();
    }

    //#endregion

    //#endregion
}
