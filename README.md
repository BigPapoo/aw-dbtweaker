# AppWrite DB Tweaker

This tool provides a way for people who, like me, are missing a feature to rename, reorder or resize attributes in AppWrite collections.
Hopefully AppWrite team will provide one soon... Until then this little script can help.

## What it can do on attributes

-  Renaming
-  Resizing
-  Cloning
-  Deleting
-  Reordering

## How does it work

To prevent messing with the internals of AppWrite, it simply works by cloning attributes to make the changes, using AppWrite official API.
Certainly not the ideal solution as it implies side effects (see comments on Sample usage), but it works for me and I'll be glad with it until AppWrite team provides me a better and more integrated way to do! 😉

# Getting started

This tool uses `NodeJS`. So you need to install a Node environment before going any step further.
Then:

-  `npm install`
-  Create an AppWrite `API KEY` with at least all `Database` right (`read` and `write` on `databases`, `collections`, `attributes`, `documents`).
-  Optional: duplicate `env.sample` to `.env` and fill the file with your credentials and IDs
-  For help: `node aw-dbtweaker.js --help`

## Environment vars

Either pass some or all of `API_KEY`, `PROJECT ID` and `DATABASE ID` values as `--arguments` or use a `.env` file
Rename `env.sample` file to `.env` if needed.

## Sample usage on collection attributes

❗️❗️❗️ Some actions (\*) change the attributes order and the documents timestamp ❗️❗️❗️

-  Help : `node aw-dbtweaker.js --help`
-  List attributes : `node aw-dbtweaker.js [options] list`
-  Rename an attribute (\*) : `node aw-dbtweaker.js [options] rename old new`
-  Rename and Resize an attribute (\*) : `node aw-dbtweaker.js [options] rename old new 50`
-  Resize an attribute (\*) : `node aw-dbtweaker.js [options] resize name 50`
-  Clone an attribute : `node aw-dbtweaker.js [options] clone orig new`
-  Reorder attribute (\*) : `node aw-dbtweaker.js [options] reorder first second...`
-  Delete attribute : `node aw-dbtweaker.js [options] delete name`

## 🔥 Warning 🔥

Make a backup before processing!
