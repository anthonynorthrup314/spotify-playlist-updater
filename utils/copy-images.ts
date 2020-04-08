import * as shell from "shelljs";

// Copy all the images
shell.mkdir("dist/public");
shell.cp("-R", "src/public/images", "dist/public/");