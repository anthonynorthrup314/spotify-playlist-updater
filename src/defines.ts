export const COOKIE_RETURN_URL = "return_url";
export const COOKIE_USER_ID = "user_id";

export const SIGNED_COOKIE_ACCESS_TOKEN = "access_token";
export const SIGNED_COOKIE_EXPIRE_LOGOUT = "must_logout_after";
export const SIGNED_COOKIE_EXPIRE_REFRESH = "try_refresh_after";
export const SIGNED_COOKIE_REFRESH_TOKEN = "refresh_token";
export const SIGNED_COOKIE_STATE = "state";

export const MESSAGE_LAST_UPDATED_PREFIX = "Last Updated:";
export const MESSAGE_NEVER_UPDATED = "Never Updated";
export const MESSAGE_VARIOUS_ARTISTS = "Various Artists";

export interface DbArtist {
    id: string;
    info: ArtistObjectSimplified;
}

export interface DbPlaylistSimplified {
    count: number;
    id: string;
    info: PlaylistSimplified;
    lastCached: Date;
    lastUpdated: Date;
    mainArtist: string;
    updatedMessage: string;
    userID: string;
    variousArtists: boolean;
}

export interface DbPlaylist extends DbPlaylistSimplified {
    cache: TrackObjectFull[];
}

export interface DbPlaylists {
    cache: string[];
    count: number;
    lastCached: Date;
}

export interface DbUser {
    id: string;
    info: UserObjectPrivate;
    playlists: DbPlaylists;
}

export interface TracksToAdd {
    dateArtistWasChecked: Date;
    trackURIs: string[];
}

export interface TrackWithAlbum extends TrackObjectSimplified {
    album: AlbumObjectFull;
}

// https://developer.spotify.com/documentation/web-api/reference/object-model/

export enum AlbumGroup {
    album = "album",
    appears_on = "appear_on",
    compilation = "compilation",
    single = "single"
}

export enum AlbumType {
    album = "album",
    compilation = "compilation",
    single = "single"
}

export enum ReleaseDatePrecision {
    day = "day",
    month = "month",
    year = "year"
}

export interface AlbumObjectSimplified {
    /**
     * The field is present when getting an artist’s albums. Possible values are “album”, “single”, “compilation”,
     * “appears_on”. Compare to album_type this field represents relationship between the artist and the album.
     */
    album_group?: AlbumGroup;

    /** The type of the album: one of “album”, “single”, or “compilation”. */
    album_type: AlbumType;

    /** The artists of the album. Each artist object includes a link in href to more detailed information about the artist. */
    artists: ArtistObjectSimplified[];

    /**
     * The markets in which the album is available: ISO 3166-1 alpha-2 country codes. Note that an album is
     * considered available in a market when at least 1 of its tracks is available in that market.
     */
    available_markets: string[];

    /** Known external URLs for this album. */
    external_urls: ExternalURLs;

    /** A link to the Web API endpoint providing full details of the album. */
    href: string;

    /** The Spotify ID for the album. */
    id: string;

    /** The cover art for the album in various sizes, widest first. */
    images: ImageObject[];

    /** The name of the album. In case of an album takedown, the value may be an empty string. */
    name: string;

    /** The date the album was first released, for example 1981. Depending on the precision, it might be shown as 1981-12 or 1981-12-15. */
    release_date: string;

    /** The precision with which release_date value is known: year , month , or day. */
    release_date_precision: ReleaseDatePrecision;

    /**
     * Part of the response when Track Relinking is applied, the original track is not available in the given market, and Spotify
     * did not have any tracks to relink it with. The track response will still contain metadata for the original track, and a
     * restrictions object containing the reason why the track is not available: "restrictions" : {"reason" : "market"}
     */
    restrictions: Restrictions;

    /** The object type: “album” */
    type: string;

    /** The Spotify URI for the album. */
    uri: string;
}

export interface AlbumObjectFull extends AlbumObjectSimplified {
    /** The copyright statements of the album. */
    copyrights: Copyright[];

    /** Known external IDs for the album. */
    external_ids: ExternalIDs;

    /**
     * A list of the genres used to classify the album. For example: "Prog Rock" , "Post-Grunge". (If not yet classified,
     * the array is empty.)
     */
    genres: string[];

    /** The label for the album. */
    label: string;

    /**
     * The popularity of the album. The value will be between 0 and 100, with 100 being the most popular. The popularity is
     * calculated from the popularity of the album’s individual tracks.
     */
    popularity: number;

    /** The tracks of the album. */
    tracks: PagingObject<TrackObjectSimplified>;
}

export interface ArtistObjectSimplified {
    /** Known external URLs for this artist. */
    external_urls: ExternalURLs;

    /** A link to the Web API endpoint providing full details of the artist. */
    href: string;

    /** The Spotify ID for the artist. */
    id: string;

    /** The name of the artist. */
    name: string;

    /** The object type: "artist" */
    type: string;

    /** The Spotify URI for the artist. */
    uri: string;
}

export interface ArtistObjectFull extends ArtistObjectSimplified {
    /** Information about the followers of the artist. */
    followers: Followers;

    /**
     * A list of the genres the artist is associated with. For example: "Prog Rock" , "Post-Grunge".
     * (If not yet classified, the array is empty.)
     */
    genres: string[];

    /** Images of the artist in various sizes, widest first. */
    images: ImageObject[];

    /**
     * The popularity of the artist. The value will be between 0 and 100, with 100 being the most popular.
     * The artist’s popularity is calculated from the popularity of all the artist’s tracks.
     */
    popularity: number;
}

export interface Copyright {
    /** The copyright text for this album. */
    text: string;

    /** The type of copyright: C = the copyright, P = the sound recording (performance) copyright. */
    type: string;
}

export interface EmptyPagingObject<T> {
    /** A link to the Web API endpoint returning the full result of the request. */
    href: string;

    /** The maximum number of items available to return. */
    total: number;
}

export interface EpisodeObjectFull {
    /** A URL to a 30 second preview (MP3 format) of the episode. null if not available. */
    audio_preview_url: string;

    /** A description of the episode. */
    description: string;

    /** The episode length in milliseconds. */
    duration_ms: number;

    /** Whether or not the episode has explicit content (true = yes it does; false = no it does not OR unknown). */
    explicit: boolean;

    /** External URLs for this episode. */
    external_urls: ExternalURLs;

    /** A link to the Web API endpoint providing full details of the episode. */
    href: string;

    /** The Spotify ID for the episode. */
    id: string;

    /** The cover art for the episode in various sizes, widest first. */
    images: ImageObject[];

    /** True if the episode is hosted outside of Spotify’s CDN. */
    is_externally_hosted: boolean;

    /** True if the episode is playable in the given market. Otherwise false. */
    is_playable: boolean;

    /**
     * Note: This field is deprecated and might be removed in the future. Please use the languages field instead.
     * The language used in the episode, identified by a ISO 639 code.
     */
    language: string;

    /** A list of the languages used in the episode, identified by their ISO 639 code. */
    languages: string[];

    /** The name of the episode. */
    name: string;

    /**
     * The date the episode was first released, for example "1981-12-15". Depending on the precision, it might be
     * shown as "1981" or "1981-12".
     */
    release_date: string;

    /** The precision with which release_date value is known: "year", "month", or "day". */
    release_date_precision: string;

    /**
     * The user’s most recent position in the episode. Set if the supplied access token is a user token and has the
     * scope user-read-playback-position.
     */
    resume_point: ResumePoint;

    /** The show on which the episode belongs. */
    show: ShowObjectSimplified;

    /** The object type: "episode". */
    type: string;

    /** The Spotify ID for the episode. */
    uri: string;
}

/**
 * The identifier type, for example:
 * "isrc" - International Standard Recording Code
 * "ean" - International Article Number
 * "upc" - Universal Product Code
 */
export type ExternalIDs = { [key: string]: string };

export type ExternalURLs = { [key: string]: string };

export interface Followers {
    /**
     * A link to the Web API endpoint providing full details of the followers; null if not available.
     * Please note that this will always be set to null, as the Web API does not support it at the moment.
     */
    href: string;

    /** The total number of followers. */
    total: number;
}

export interface ImageObject {
    /** The image height in pixels. If unknown: null or not returned. */
    height: number;

    /** The source URL of the image. */
    url: string;

    /** The image width in pixels. If unknown: null or not returned. */
    width: number;
}

export interface LinkedTrack {
    /** Known external URLs for this track. */
    external_urls: ExternalURLs;

    /** A link to the Web API endpoint providing full details of the track. */
    href: string;

    /** The Spotify ID for the track. */
    id: string;

    /** The object type: “track”. */
    type: string;

    /** The Spotify URI for the track. */
    uri: string;
}

export interface PagingObject<T> extends EmptyPagingObject<T> {
    /** The requested data. */
    items: T[];

    /** The maximum number of items in the response (as set in the query or by default). */
    limit: number;

    /** URL to the next page of items. (null if none) */
    next: string;

    /** The offset of the items returned (as set in the query or by default). */
    offset: number;

    /** URL to the previous page of items. (null if none) */
    previous: string;
}

export interface PlaylistSimplified {
    /** Returns true if context is not search and the owner allows other users to modify the playlist. Otherwise returns false. */
    collaborative: boolean;

    /** The playlist description. Only returned for modified, verified playlists, otherwise null. */
    description: string;

    /** Known external URLs for this playlist. */
    external_urls: ExternalURLs;

    /** A link to the Web API endpoint providing full details of the playlist. */
    href: string;

    /** The Spotify ID for the playlist. */
    id: string;

    /**
     * Images for the playlist. The array may be empty or contain up to three images. The images are returned by size in descending order.
     * See Working with Playlists. Note: If returned, the source URL for the image (url) is temporary and will expire in less than a day.
     */
    images: ImageObject[];

    /** The name of the playlist. */
    name: string;

    /** The user who owns the playlist. */
    owner: UserObjectPublic;

    /**
     * The playlist’s public/private status: true the playlist is public, false the playlist is private, null the
     * playlist status is not relevant. For more about public/private status, see Working with Playlists.
     */
    public: boolean | null;

    /** The version identifier for the current playlist. Can be supplied in other requests to target a specific playlist version. */
    snapshot_id: string;

    /** Information about the tracks of the playlist. */
    tracks: EmptyPagingObject<PlaylistTrack>;

    /** The object type: “playlist” */
    type: string;

    /** The Spotify URI for the playlist. */
    uri: string;
}

export interface PlaylistFull extends PlaylistSimplified {
    /** Information about the followers of the playlist. */
    followers: Followers;
}

export interface PlaylistTrack {
    /** The date and time the track or episode was added. Note that some very old playlists may return null in this field. */
    added_at: Date;

    /** The Spotify user who added the track or episode. Note that some very old playlists may return null in this field. */
    added_by: UserObjectPublic;

    /** Whether this track or episode is a local file or not. */
    is_local: boolean;

    /** Information about the track or episode. */
    track: EpisodeObjectFull | TrackObjectFull;
}

export interface Restrictions {
    reason?: string;
}

export interface ResumePoint {
    /** Whether or not the episode has been fully played by the user. */
    fully_played: boolean;

    /** The user’s most recent position in the episode in milliseconds. */
    resume_position_ms: number;
}

export interface ShowObjectSimplified {
    /** A list of the countries in which the show can be played, identified by their ISO 3166-1 alpha-2 code. */
    available_markets: string[];

    /** The copyright statements of the show. */
    copyrights: Copyright[];

    /** A description of the show. */
    description: string;

    /** Whether or not the show has explicit content (true = yes it does; false = no it does not OR unknown). */
    explicit: boolean;

    /** Known external URLs for this show. */
    external_urls: ExternalURLs;

    /** A link to the Web API endpoint providing full details of the show. */
    href: string;

    /** The Spotify ID for the show. */
    id: string;

    /** The cover art for the show in various sizes, widest first. */
    images: ImageObject[];

    /** True if all of the show’s episodes are hosted outside of Spotify’s CDN. This field might be null in some cases. */
    is_externally_hosted: boolean;

    /** A list of the languages used in the show, identified by their ISO 639 code. */
    languages: string[];

    /** The media type of the show. */
    media_type: string;

    /** The name of the show. */
    name: string;

    /** The publisher of the show. */
    publisher: string;

    /** The object type: “show”. */
    type: string;

    /** The Spotify URI for the show. */
    uri: string;
}

export interface TokenResponse {
    /** An access token that can be provided in subsequent calls, for example to Spotify Web API services. */
    access_token: string;

    /** The time period (in seconds) for which the access token is valid. */
    expires_in: number;

    /**
     * A token that can be sent to the Spotify Accounts service in place of an authorization code. (When the access code
     * expires, send a POST request to the Accounts service /api/token endpoint, but use this code in place of an
     * authorization code. A new access token will be returned. A new refresh token might be returned too.)
     */
    refresh_token?: string;

    /** A space-separated list of scopes which have been granted for this access_token */
    scope: string;

    /** How the access token may be used: always "Bearer". */
    token_type: string;
}

export interface TrackObjectSimplified {
    /** The artists who performed the track. Each artist object includes a link in href to more detailed information about the artist. */
    artists: ArtistObjectSimplified[];

    /** A list of the countries in which the track can be played, identified by their ISO 3166-1 alpha-2 code. */
    available_markets: string[];

    /** The disc number (usually 1 unless the album consists of more than one disc). */
    disc_number: number;

    /** The track length in milliseconds. */
    duration_ms: number;

    /** Whether or not the track has explicit lyrics ( true = yes it does; false = no it does not OR unknown). */
    explicit: boolean;

    /** Known external URLs for this track. */
    external_urls: ExternalURLs;

    /** A link to the Web API endpoint providing full details of the track. */
    href: string;

    /** The Spotify ID for the track. */
    id: string;

    /** Whether or not the track is from a local file. */
    is_local: boolean;

    /** Part of the response when Track Relinking is applied. If true , the track is playable in the given market. Otherwise false. */
    is_playable: boolean;

    /**
     * Part of the response when Track Relinking is applied, and the requested track has been replaced with different track.
     * The track in the linked_from object contains information about the originally requested track.
     */
    linked_from: LinkedTrack;

    /**
     * Part of the response when Track Relinking is applied, the original track is not available in the given market, and Spotify
     * did not have any tracks to relink it with. The track response will still contain metadata for the original track, and a
     * restrictions object containing the reason why the track is not available: "restrictions" : {"reason" : "market"}
     */
    restrictions: Restrictions;

    /** The name of the track. */
    name: string;

    /** A link to a 30 second preview (MP3 format) of the track. Can be null. */
    preview_url: string;

    /** The number of the track. If an album has several discs, the track number is the number on the specified disc. */
    track_number: number;

    /** The object type: “track”. */
    type: string;

    /** The Spotify URI for the track. */
    uri: string;
}

export interface TrackObjectFull extends TrackObjectSimplified {
    /** The album on which the track appears. The album object includes a link in href to full information about the album. */
    album: AlbumObjectSimplified;

    /** Known external IDs for the track. */
    external_ids: ExternalIDs;

    /**
     * The popularity of the track. The value will be between 0 and 100, with 100 being the most popular.
     * The popularity of a track is a value between 0 and 100, with 100 being the most popular. The popularity is calculated
     * by algorithm and is based, in the most part, on the total number of plays the track has had and how recent those plays are.
     * Generally speaking, songs that are being played a lot now will have a higher popularity than songs that were played a lot
     * in the past. Duplicate tracks (e.g. the same track from a single and an album) are rated independently. Artist and album
     * popularity is derived mathematically from track popularity. Note that the popularity value may lag actual popularity by a
     * few days: the value is not updated in real time.
     */
    popularity: number;
}

export interface UserObjectPrivate extends UserObjectPublic {
    /**
     * The country of the user, as set in the user's account profile. An ISO 3166-1 alpha-2 country code. This
     * field is only available when the current user has granted access to the user-read-private scope.
     */
    country: string;

    /**
     * The user's email address, as entered by the user when creating their account.
     * Important! This email address is unverified; there is no proof that it actually belongs to the user.
     * This field is only available when the current user has granted access to the user-read-email scope.
     */
    email?: string;

    /**
     * The user's Spotify subscription level: "premium", "free", etc. (The subscription level "open" can be considered the
     * same as "free".) This field is only available when the current user has granted access to the user-read-private scope.
     */
    product: string;
}

export interface UserObjectPublic {
    /** The name displayed on the user's profile. null if not available. */
    display_name: string;

    /** Known external URLs for this user. */
    external_urls: ExternalURLs;

    /** Information about the followers of the user. */
    followers: Followers;

    /** A link to the Web API endpoint for this user. */
    href: string;

    /** The Spotify user ID for the user. */
    id: string;

    /** The user's profile image. */
    images: ImageObject[];

    /** The object type: "user" */
    type: string;

    /** The Spotify URI for the user. */
    uri: string;
}
