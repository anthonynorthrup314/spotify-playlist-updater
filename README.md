# spotify-playlist-updater

Update playlists with new music from the artist of the playlist. This app is targetted
at public single artist playlists created by the user via Spotify. I am still working
on the creation feature, but listing / updating should be fully functional. See below
for more information on how this can be used.

Mobile should be supported, however it is currently untested. So long as you can login
to your Spotify account in the browser, this should function as intended.

Note: If you'd like to list / update private playlists, simply update the `SCOPE` variable
within your `.env` file (or environment variables) to add `playlist-read-private playlist-modify-private`.
More details can be found within the [Spotify Web API documentation](https://developer.spotify.com/documentation/general/guides/scopes/).

## Tech Stack

Refer to the package.json file for a complete rundown, but here is a brief summary.

### Backend

- [axios](https://github.com/axios/axios): An easier API for making web requests
- [Express](https://expressjs.com/): Runs the server
- [lowDB](https://github.com/typicode/lowdb): Stores the database of users and their playlist metadata
- [TypeScript](https://www.typescriptlang.org/)

### Frontend

- [Bootstrap](https://getbootstrap.com/)
- [EJS](https://ejs.co/) (technically used in the backend to produce the HTML)
- [Font Awesome](https://fontawesome.com/) (for icons)
- [jQuery](https://jquery.com/)

## Usage

1. Log in with your Spotify account (uses OAuth redirection)
1. Select a playlist for updating
    - The playlists are cached for 24 hours. You can click Refresh Playlists to get the latest
1. Click the Update Playlist button
    - When first clicked, this will detect the artist for the playlist
    - The tracks are cached for 7 days. You can click Refresh Playlist to get the latest
1. Once the dialog appears with the newly detected tracks, click Add Tracks
1. Repeat as needed

## Planned Features

- Creation of new playlists for specific artists
  - This will likely also come with a delete button for playlists created by this app
- A new color scheme (my friends who tested so far weren't happy with the lack of a dark theme...)
- Indicators for (possible) duplicate songs
  - For example, songs released both in a single and an album
- Search for user playlists
  - The Spotify Web API currently doesn't have support for folders ([and likely never will](https://github.com/spotify/web-api/issues/38#issuecomment-396925978)), so depending on how many playlists you have, going through them one-by-one to find the right one is probably a bit annoying
- Update all button, so you don't have to click through each playlist
