#!/bin/bash
file_name=$1
shift

npm install
node ./node_modules/.bin/ts-node "./src/$file_name.ts" "$@"
