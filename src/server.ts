import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import express, { NextFunction } from "express";
import FileAsync from "lowdb/adapters/FileAsync";
import lowdb from "lowdb";
import path from "path";
import queryString from "query-string";
import * as rp from "request-promise";
import { v4 as uuid } from "uuid";

import { TokenResponse, SIGNED_COOKIE_ACCESS_TOKEN, COOKIE_RETURN_URL, SIGNED_COOKIE_REFRESH_TOKEN, SIGNED_COOKIE_EXPIRE_REFRESH, SIGNED_COOKIE_STATE, UserObjectPrivate, COOKIE_USER_ID, SIGNED_COOKIE_EXPIRE_LOGOUT, DbUser, PagingObject, PlaylistSimplified, DbPlaylist, PlaylistTrack, TrackObjectFull, MESSAGE_NEVER_UPDATED, MESSAGE_VARIOUS_ARTISTS, MESSAGE_LAST_UPDATED_PREFIX, DbPlaylistSimplified, PlaylistFull, ArtistObjectSimplified, ArtistObjectFull, TrackObjectSimplified, AlbumObjectSimplified, DbArtist, AlbumObjectFull, TrackWithAlbum, AlbumType, TracksToAdd } from "./defines";

/*
 * Reference:
 * https://developer.spotify.com/documentation/general/guides/authorization-guide/#authorization-code-flow
 * https://developer.spotify.com/console/get-current-user-playlists/
 * https://developer.spotify.com/documentation/web-api/reference/playlists/get-a-list-of-current-users-playlists/
 * https://getbootstrap.com/docs/4.0/components/
 * https://fontawesome.com/icons?d=gallery
 */

// Handle the config
dotenv.config();
const port = +process.env.PORT;
const hostUrl = process.env.HOST_URL || `http://localhost:${port}`;
const spotifyAuthParams = {
    client_id: process.env.CLIENT_ID,
    redirect_uri: `${hostUrl}/callback`,
    scope: process.env.SCOPE
};
const spotifyClientSecret = process.env.CLIENT_SECRET;
const spotifyBasicAuth = Buffer.from(`${spotifyAuthParams.client_id}:${spotifyClientSecret}`).toString("base64");
const cookieSecret = process.env.COOKIE_SECRET;

// Constants
const playlistsToGetPerRequest = 50;
const playlistsExpireAfterNDays = 1;
const tracksToGetPerRequest = 100;
const tracksExpireAfterNDays = 7;
const mainArtistThreshold = 0.75;
const albumsToGetPerRequest = 20;
const tracksToAddPerRequest = 100;

// Date functions
const daySuffix = "th";
const daySuffixes = [daySuffix, "st", "nd", "rd"];
const monthsOfTheYear = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function addDays(date: Date, n: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + n);
    return result;
}
function addSeconds(date: Date, n: number): Date {
    const result = new Date(date);
    result.setSeconds(result.getSeconds() + n);
    return result;
}
function dateString(date: Date): string {
    const dayOfTheMonth = date.getDate();
    const suffix = (dayOfTheMonth % 10) < daySuffixes.length ? daySuffixes[dayOfTheMonth % 10] : daySuffix;
    return `${monthsOfTheYear[date.getMonth()]} ${dayOfTheMonth}${suffix}, ${date.getFullYear()} at ${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
}
function twoDigits(n: number): string {
    if (n < 10)
        return `0${n}`;
    return `${n}`;
}

// Update JSON.parse to support dates
const oldParse = JSON.parse;
const dateISORegex = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d*))(?:Z|(\+|-)([\d|:]*))?$/;
JSON.parse = (text: string): any => oldParse(text, (key: string, value: any): any => {
    if (typeof value === "string" && dateISORegex.test(value))
        return new Date(value);
    else
        return value;
});

// Helpers
type DbState = { users: DbUser[], playlists: DbPlaylist[], artists: DbArtist[] };
type DbType = lowdb.LowdbAsync<DbState>;
function handleAsync(cb: (req: express.Request, res: express.Response, next: NextFunction) => Promise<any>) {
    return (req: express.Request, res: express.Response, next: NextFunction) => cb(req, res, next).catch(next);
}
function formatLength(value: number): string {
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
async function ensurePlaylistsForPage(db: DbType, id: string, page: number, accessToken: string): Promise<void> {
    // Cache some DB values
    const dbUser = db.get("users").find(user => user.id === id);
    const dbUserPlaylists = dbUser.get("playlists");
    let maxCount = dbUserPlaylists.get("count").value();

    // Perform hard refresh?
    let cachedSize: number;
    if (maxCount < 0 || addDays(dbUserPlaylists.get("lastCached").value(), playlistsExpireAfterNDays) <= new Date()) {
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
            hasData = cachedSize > (page - 1) * playlistsToGetPerRequest;
            if (hasData && cachedSize < maxCount)
                hasData = (page + 1) * playlistsToGetPerRequest > maxCount;
        } else
            hasData = true;
        if (hasData)
            return;
    }

    // List of playlists being added
    const addedPlaylists: PlaylistSimplified[] = [];

    // Need to get first page?
    let lastPage = Math.ceil(cachedSize / playlistsToGetPerRequest);
    if (lastPage <= 1) {
        // Get the first page
        const params = queryString.stringify({
            limit: playlistsToGetPerRequest,
            offset: 0
        });
        const playlists: PagingObject<PlaylistSimplified> = await rp.get(`https://api.spotify.com/v1/me/playlists?${params}`, {
            headers: {
                Authorization: `Bearer ${accessToken}`
            },
            json: true
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
    page = Math.min(page, Math.ceil(maxCount / playlistsToGetPerRequest));
    for (; lastPage < page; lastPage++) {
        // Get the page
        const params = queryString.stringify({
            limit: playlistsToGetPerRequest,
            offset: lastPage * playlistsToGetPerRequest
        });
        const playlists: PagingObject<PlaylistSimplified> = await rp.get(`https://api.spotify.com/v1/me/playlists?${params}`, {
            headers: {
                Authorization: `Bearer ${accessToken}`
            },
            json: true
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
    const dbPlaylists = db.get("playlists");
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
async function ensureTracksForPage(db: DbType, id: string, page: number, accessToken: string): Promise<void> {
    // Cache some DB values
    const dbPlaylist = db.get("playlists").find(playlist => playlist.id === id);
    let maxCount = dbPlaylist.get("count").value();

    // Perform hard refresh?
    let cachedSize: number;
    if (maxCount < 0 || addDays(dbPlaylist.get("lastCached").value(), tracksExpireAfterNDays) <= new Date()) {
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
            hasData = cachedSize > (page - 1) * tracksToGetPerRequest;
            if (hasData && cachedSize < maxCount)
                hasData = (page + 1) * tracksToGetPerRequest > maxCount;
        } else
            hasData = true;
        if (hasData)
            return;
    }

    // List of tracks being added
    const addedTracks: PlaylistTrack[] = [];

    // Need to get first page?
    let lastPage = Math.ceil(cachedSize / tracksToGetPerRequest);
    if (lastPage <= 1) {
        // Get the first page
        const params = queryString.stringify({
            limit: tracksToGetPerRequest,
            offset: 0
        });
        const tracks: PagingObject<PlaylistTrack> = await rp.get(`https://api.spotify.com/v1/playlists/${id}/tracks?${params}`, {
            headers: {
                Authorization: `Bearer ${accessToken}`
            },
            json: true
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
    page = Math.min(page, Math.ceil(maxCount / tracksToGetPerRequest));
    for (; lastPage < page; lastPage++) {
        // Get the page
        const params = queryString.stringify({
            limit: tracksToGetPerRequest,
            offset: lastPage * tracksToGetPerRequest
        });
        const tracks: PagingObject<PlaylistTrack> = await rp.get(`https://api.spotify.com/v1/playlists/${id}/tracks?${params}`, {
            headers: {
                Authorization: `Bearer ${accessToken}`
            },
            json: true
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
async function getToken(db: DbType, res: express.Response, data: { grant_type: "authorization_code", code: string, redirect_uri: string } | { grant_type: "refresh_token", refresh_token: string }): Promise<void> {
    const tokenResp: TokenResponse = await rp.post("https://accounts.spotify.com/api/token", {
        form: data,
        headers: {
            Authorization: `Basic ${spotifyBasicAuth}`
        },
        json: true
    });

    res.cookie(SIGNED_COOKIE_ACCESS_TOKEN, tokenResp.access_token, { signed: true });
    if (tokenResp.refresh_token)
        res.cookie(SIGNED_COOKIE_REFRESH_TOKEN, tokenResp.refresh_token, { signed: true });
    res.cookie(SIGNED_COOKIE_EXPIRE_REFRESH, addSeconds(new Date(), Math.floor(tokenResp.expires_in * 0.5)).toString(), { signed: true });
    res.cookie(SIGNED_COOKIE_EXPIRE_LOGOUT, addSeconds(new Date(), Math.floor(tokenResp.expires_in * 0.99)).toString(), { signed: true });

    // Get the current user's info
    const userResp: UserObjectPrivate = await rp.get("https://api.spotify.com/v1/me", {
        headers: {
            Authorization: `Bearer ${tokenResp.access_token}`
        },
        json: true
    });

    res.cookie(COOKIE_USER_ID, userResp.id);

    // Initialize DB entry
    const dbUsers = db.get("users");
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
    await ensurePlaylistsForPage(db, userResp.id, 1, tokenResp.access_token);
}
async function checkCredentials(db: DbType, req: express.Request, res: express.Response): Promise<boolean> {
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
            await getToken(db, res, {
                grant_type: "refresh_token",
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
async function refreshPlaylist(db: DbType, id: string, accessToken: string): Promise<void> {
    // Clear the cached tracks
    const dbPlaylist = db.get("playlists").find(playlist => playlist.id === id);
    await dbPlaylist.set("cache", [])
        .set("count", -1)
        .set("lastCached", new Date(0))
        .write();

    // Get the latest playlist info
    const info: PlaylistFull = await rp.get(`https://api.spotify.com/v1/playlists/${id}`, {
        headers: {
            Authorization: `Bearer ${accessToken}`
        },
        json: true
    });
    await dbPlaylist.set("info", info).write();
}

// Setup the server
const app = express();
app.set("views", path.join(__dirname, "./views"));
app.set("view engine", "ejs");
app.use(bodyParser.json());
app.use(cookieParser(cookieSecret));

// Host public files
app.use("/static", express.static(path.join(__dirname, "./public")));

// Setup the DB
lowdb(new FileAsync(path.join(__dirname, "../db.json")))
    .then((db: DbType) => {
        // Setup the routes
        app.get("/", handleAsync(async (req, res) => {
            // Logged in?
            if (req.signedCookies[SIGNED_COOKIE_ACCESS_TOKEN]) {
                if (!(await checkCredentials(db, req, res)))
                    res.redirect("/playlists");
            }
            else
                res.render("pages/index", { loggedIn: false });
        }));
        app.get("/callback", handleAsync(async (req, res) => {
            let error: string = req.query.error;
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
                await getToken(db, res, {
                    grant_type: "authorization_code",
                    code: req.query.code,
                    redirect_uri: spotifyAuthParams.redirect_uri
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
        }));
        app.get("/create", handleAsync(async (req, res) => {
            if (await checkCredentials(db, req, res))
                return;

            res.render("pages/create", {
                loggedIn: true,
                userID: req.cookies[COOKIE_USER_ID] as string
            });
        }));
        app.get("/login", (req, res) => {
            // Create a new state
            const state = uuid();
            res.cookie(SIGNED_COOKIE_STATE, state, { signed: true });

            // Redirect to Spotify for authorization
            const params = queryString.stringify({
                response_type: "code",
                ...spotifyAuthParams,
                state
            });
            res.redirect(`https://accounts.spotify.com/authorize?${params}`);
        });
        app.get("/logout", (req, res) => {
            // Clear all the cookies
            Object.keys(req.cookies)
                .filter(key => typeof req.cookies[key] === "string")
                .forEach(key => res.clearCookie(key));
            Object.keys(req.signedCookies)
                .filter(key => typeof req.signedCookies[key] === "string")
                .forEach(key => res.clearCookie(key, { signed: true }));

            // Render the results
            res.render("pages/logout", { loggedIn: false });
        });
        app.get("/playlist", (req, res) => {
            res.redirect("/playlists");
        });
        app.get("/playlist/:playlistID", handleAsync(async (req, res) => {
            if (await checkCredentials(db, req, res))
                return;

            // Get the playlist info
            const id: string = req.params.playlistID;
            const playlist = db.get("playlists").find(p => p.id === id).value();

            // Get the main artist, if any
            let mainArtist: ArtistObjectSimplified = null;
            if (playlist.mainArtist)
                mainArtist = db.get("artists").find(artist => artist.id === playlist.mainArtist).get("info").value();

            // Render the page
            res.render("pages/playlist", {
                loggedIn: true,
                playlist,
                mainArtist
            });
        }));
        app.get("/playlist/:playlistID/latest", handleAsync(async (req, res) => {
            // No need to verify login, will throw an error during the request to Spotify

            // Parse the request params
            const id: string = req.params.playlistID;
            const accessToken: string = req.signedCookies[SIGNED_COOKIE_ACCESS_TOKEN];
            const requestParams = {
                headers: {
                    "Authorization": `Bearer ${accessToken}`
                },
                json: true
            };

            // Get the playlist info
            const dbPlaylist = db.get("playlists").find(p => p.id === id);
            let playlist = dbPlaylist.value();

            // Main artist identified?
            if (!playlist.variousArtists && !playlist.mainArtist) {
                // Search the first page of songs
                await ensureTracksForPage(db, id, 1, accessToken);
                playlist = dbPlaylist.value();

                // Attempt to identify the main artist
                let mainArtist: string;
                type artistEntry = { info: ArtistObjectSimplified, count: number };
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
                    if (entry.count < mainArtistThreshold * playlist.cache.length)
                        // Not good enough
                        mainArtist = null;
                } else if (artistsFound.size) {
                    // Take the artist that occurred the most within the playlist
                    const entries: artistEntry[] = [];
                    artistsFound.forEach(entry => entries.push(entry));
                    const mainArtistEntry = entries.sort((a, b) => b.count - a.count)[0];
                    if (mainArtistEntry.count > mainArtistThreshold * playlist.cache.length)
                        mainArtist = mainArtistEntry.info.id;
                }

                // Main artist found?
                if (mainArtist) {
                    // Get the full artist info (mainly for their image)
                    const info: ArtistObjectFull = await rp.get(`https://api.spotify.com/v1/artists/${mainArtist}`, requestParams);

                    // Update the DB
                    await dbPlaylist.set("mainArtist", mainArtist).write();
                    const dbArtists = db.get("artists");
                    const dbArtist = dbArtists.find(artist => artist.id === mainArtist);
                    if (dbArtist.isUndefined().value())
                        await dbArtists.push({ id: mainArtist, info }).write();
                    else
                        await dbArtist.set("info", info).write();

                    // Ensure all tracks are loaded
                    await ensureTracksForPage(db, id, -1, accessToken);
                    playlist = dbPlaylist.value();

                    // Find the date of the last track that was added
                    let lastUpdated = playlist.lastUpdated;
                    for (const track of playlist.cache) {
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
                        .set("updatedMessage", `${MESSAGE_LAST_UPDATED_PREFIX} ${dateString(lastUpdated)}`)
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
                res.status(404).send("Could not identify main artist. Unable to find new tracks.");
                return;
            }

            // TODO: Get the latest albums for the selected artist
            const dateArtistWasChecked = new Date();
            const newAlbumIDs: string[] = [];
            const artistParams = queryString.stringify({
                include_groups: "album,single",
                limit: 50,
                offset: 0
            });
            let artistUrl = `https://api.spotify.com/v1/artists/${playlist.mainArtist}/albums?${artistParams}`;
            while (artistUrl) {
                const albums: PagingObject<AlbumObjectSimplified> = await rp.get(artistUrl, requestParams);
                newAlbumIDs.push(...albums.items.map(album => album.id));
                artistUrl = albums.next;
            }

            // Convert to albums
            let newAlbums: AlbumObjectFull[] = [];
            for (let i = 0; i < newAlbumIDs.length; i += albumsToGetPerRequest) {
                const params = queryString.stringify({
                    ids: newAlbumIDs.slice(i, i + albumsToGetPerRequest).join(",")
                });
                const albumUrl = `https://api.spotify.com/v1/albums?${params}`;
                const albums: { albums: AlbumObjectFull[] } = await rp.get(albumUrl, requestParams);
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
                    const tracks: PagingObject<TrackObjectSimplified> = await rp.get(trackUrl, requestParams);
                    albumTracks.push(...tracks.items);
                    trackUrl = tracks.next;
                }

                // Add to the list
                newTracks.push(...albumTracks.map(track => ({ ...track, album } as TrackWithAlbum)));
            }

            // Ensure all tracks are loaded
            await ensureTracksForPage(db, id, -1, accessToken);
            playlist = dbPlaylist.value();

            // Remove any already present in the playlist
            const currentTracks = new Set<string>();
            for (const track of playlist.cache)
                currentTracks.add(track.id);
            newTracks = newTracks.filter(track => !currentTracks.has(track.id));

            // TODO: Handle singles vs albums, etc.

            // Render the results
            if (newTracks.length)
                res.render("stubs/new_tracks", { newTracks, dateArtistWasChecked, formatLength });
            else {
                await dbPlaylist.set("lastCached", dateArtistWasChecked)
                    .set("updatedMessage", `${MESSAGE_LAST_UPDATED_PREFIX} ${dateString(dateArtistWasChecked)}`)
                    .write();
                res.status(404).send("No new tracks found.");
            }
        }));
        app.get("/playlist/:playlistID/tracks", (req, res) => {
            res.redirect(`/playlist/${req.params.playlistID}/tracks/1`);
        });
        app.get("/playlist/:playlistID/tracks/:page", handleAsync(async (req, res) => {
            if (await checkCredentials(db, req, res))
                return;

            // Invalid page number?
            const id: string = req.params.playlistID;
            const page: number = +req.params.page;
            if (isNaN(page) || page <= 0) {
                res.redirect(`/playlist/${id}/tracks/1`);
                return;
            }

            // Ensure the page is downloaded
            await ensureTracksForPage(db, id, page, req.signedCookies[SIGNED_COOKIE_ACCESS_TOKEN]);

            // Page number too large?
            const dbPlaylist = db.get("playlists").find(p => p.id === id);
            const totalPlaylistCount = dbPlaylist.get("count").value();
            const maxPage = Math.max(1, Math.ceil(totalPlaylistCount / tracksToGetPerRequest));
            if (page > maxPage) {
                res.redirect(`/playlist/${id}/tracks/${maxPage}`);
                return;
            }

            // Get the tracks for this page
            const tracks = dbPlaylist.get("cache").value().slice((page - 1) * tracksToGetPerRequest, page * tracksToGetPerRequest);

            // Get the playlist
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
                formatLength
            });
        }));
        app.post("/playlist/:playlistID/update", handleAsync(async (req, res) => {
            // No need to verify login, will throw an error during the request to Spotify

            // Validate the params
            const id: string = req.params.playlistID;
            const tracksToAdd: TracksToAdd = req.body;

            const accessToken: string = req.signedCookies[SIGNED_COOKIE_ACCESS_TOKEN];
            try {
                // Append the tracks to the playlist
                for (let i = 0; i < tracksToAdd.trackURIs.length; i += tracksToAddPerRequest)
                    await rp.post(`https://api.spotify.com/v1/playlists/${id}/tracks`, {
                        body: {
                            uris: tracksToAdd.trackURIs.slice(i, i + tracksToAddPerRequest)
                        },
                        headers: {
                            "Authorization": `Bearer ${accessToken}`,
                            "Content-Type": "application/json"
                        },
                        json: true
                    });

                // Update the DB
                await db.get("playlists").find(playlist => playlist.id === id)
                    .set("lastUpdated", tracksToAdd.dateArtistWasChecked)
                    .set("updatedMessage", `${MESSAGE_LAST_UPDATED_PREFIX} ${dateString(tracksToAdd.dateArtistWasChecked)}`)
                    .write();
            } finally {
                // Get the latest playlist info
                await refreshPlaylist(db, id, accessToken);
            }

            // All good
            res.send("");
        }));
        app.get("/playlists", (req, res) => {
            res.redirect("/playlists/1");
        });
        app.get("/playlists/:page", handleAsync(async (req, res) => {
            if (await checkCredentials(db, req, res))
                return;

            // Invalid page number?
            const page: number = +req.params.page;
            if (isNaN(page) || page <= 0) {
                res.redirect("/playlists/1");
                return;
            }

            // Ensure the page is downloaded
            const id: string = req.cookies[COOKIE_USER_ID];
            await ensurePlaylistsForPage(db, id, page, req.signedCookies[SIGNED_COOKIE_ACCESS_TOKEN]);

            // Page number too large?
            const dbUserPlaylists = db.get("users").find(user => user.id === id).get("playlists");
            const totalPlaylistCount = dbUserPlaylists.get("count").value();
            const maxPage = Math.max(1, Math.ceil(totalPlaylistCount / playlistsToGetPerRequest));
            if (page > maxPage) {
                res.redirect(`/playlists/${maxPage}`);
                return;
            }

            // Get the playlists for this page
            const playlistIDs = dbUserPlaylists.get("cache").value().slice((page - 1) * playlistsToGetPerRequest, page * playlistsToGetPerRequest);
            const dbPlaylists = db.get("playlists");
            const playlistModels: DbPlaylistSimplified[] = [];
            for (const playlistID of playlistIDs) {
                const playlist = await dbPlaylists.find(p => p.id === playlistID).value();
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
        }));
        app.get("/refresh", handleAsync(async (req, res) => {
            // Clear the cached playlists
            const id: string = req.cookies[COOKIE_USER_ID];
            await db.get("users").find(user => user.id === id).get("playlists")
                .set("cache", [])
                .set("count", -1)
                .set("lastCached", new Date(0))
                .write();

            // Clear the cached tracks
            const dbPlaylists = db.get("playlists");
            for (const playlist of dbPlaylists.filter(p => p.userID === id).value())
                await dbPlaylists.find(p => p.id === playlist.id)
                    .set("cache", [])
                    .set("count", -1)
                    .set("lastCached", new Date(0))
                    .write();

            res.send("");
        }));
        app.get("/refresh/:playlistID", handleAsync(async (req, res) => {
            // Refresh the playlist
            const id: string = req.params.playlistID;
            const accessToken: string = req.signedCookies[SIGNED_COOKIE_ACCESS_TOKEN];
            await refreshPlaylist(db, id, accessToken);

            res.send("");
        }));
        app.get("/remove-personal-info", handleAsync(async (req, res) => {
            if (await checkCredentials(db, req, res))
                return;

            // Clear the user's data from the database
            const userID: string = req.cookies[COOKIE_USER_ID];
            await db.get("users").remove(user => user.id === userID).write();
            await db.get("playlists").remove(playlist => playlist.userID === userID).write();

            // Clear all the cookies
            Object.keys(req.cookies)
                .filter(key => typeof req.cookies[key] === "string")
                .forEach(key => res.clearCookie(key));
            Object.keys(req.signedCookies)
                .filter(key => typeof req.signedCookies[key] === "string")
                .forEach(key => res.clearCookie(key, { signed: true }));

            // Render the results
            res.render("pages/remove-personal-info", { loggedIn: false });
        }));
        app.get("/settings", handleAsync(async (req, res) => {
            if (await checkCredentials(db, req, res))
                return;

            res.render("pages/settings", { loggedIn: true });
        }));

        // Setup the default DB values
        return db.defaults({ users: [], playlists: [], artists: [] } as DbState).write();
    })
    .then(() => {
        // Start the server
        app.listen(port, () => {
            // tslint:disable-next-line:no-console
            console.log(`Server started at: ${hostUrl}`);
        });
    });