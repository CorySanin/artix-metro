# artix-metro

Artix package pushing automation tool that waits for builds to pass before continuing in the queue.

## Features

* `artix-checkupdates` is used to skip packages without pending operations
* Package upgrades wait for successful builds before moving on to the next one
* Build failures stop execution
* Perfect for scripting large, recurring rebuilds
* Increment mode for fixing packages built completely out-of-order

## Setup

`artix-checkupdates` is required. I highly recommend configuring it to use the developer artix mirror.


1) Install node dependencies with `npm install`
2) Process the typescript source with `npm exec tsc`

## Config

In addition to the robust CLI, jobs can be defined in a JSON5 or plain JSON file. For recurring tasks, either a job file or a bash script with the CLI calls is recommended. See [example.json5](jobs/example.json5) for an example job file.

## Use

In order to sign commits, artix-metro needs your GPG password. It can be provided via the `GPGPASS` environment variable.
Otherwise the program will prompt you for it on startup.

Run a job:
```
node bin/artix-metro.mjs --job jobs/example.json5
```
Run a job, skipping to a particular package:
```
node bin/artix-metro.mjs --job jobs/example.json5 --start kmail
```
Run an ad hoc job via the CLI:
```
node bin/artix-metro.mjs add stable libjpeg-turbo lib32-libjpeg-turbo
```
Notice that as long as the same shorthand works for all packages (e.g. stable, gremlins, goblins), repos can vary from package to package.
