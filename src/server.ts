import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import express from "express";
import FileAsync from "lowdb/adapters/FileAsync";
import lowdb from "lowdb";
import path from "path";

import { App, DbType, DbState } from "./app";

/*
 * Reference:
 * https://developer.spotify.com/documentation/general/guides/authorization-guide/#authorization-code-flow
 * https://developer.spotify.com/console/get-current-user-playlists/
 * https://developer.spotify.com/documentation/web-api/reference/playlists/get-a-list-of-current-users-playlists/
 * https://getbootstrap.com/docs/4.0/components/
 * https://fontawesome.com/icons?d=gallery
 */

// Update JSON.parse to support dates
const oldParse = JSON.parse;
const dateISORegex = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d*))(?:Z|(\+|-)([\d|:]*))?$/;
JSON.parse = (text: string): unknown => oldParse(text, (key: string, value: unknown): unknown => {
    if (typeof value === "string" && dateISORegex.test(value))
        return new Date(value);
    else
        return value;
});

// Setup the server
const server = express();
server.set("views", path.join(__dirname, "./views"));
server.set("view engine", "ejs");
server.use(bodyParser.json());
server.use(cookieParser(App.cookieSecret));

// Host public files
server.use("/static", express.static(path.join(__dirname, "./public")));

// Setup the DB
lowdb(new FileAsync(path.join(__dirname, "../db.json")))
    .then((db: DbType) => {
        // Setup the app
        server.use("/", new App(db).router);

        // Setup the default DB values
        const defaultState: DbState = {
            users: [],
            playlists: [],
            artists: []
        };
        return db.defaults(defaultState).write();
    })
    .then(() => {
        // Start the server
        server.listen(App.port, () => {
            // tslint:disable-next-line:no-console
            console.log(`Server started at: ${App.hostUrl}`);
        });
    });