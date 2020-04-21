#!/bin/bash
file_name=$1
shift

composer install
php "src/$file_name.php" "$@"
