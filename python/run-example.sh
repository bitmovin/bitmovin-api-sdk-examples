#!/bin/bash
file_name=$1
shift

pip3 install -r requirements.txt

PYTHONPATH="${PYTHONPATH}:$(pwd)"
export PYTHONPATH

python3 "./src/$file_name.py" "$@"
