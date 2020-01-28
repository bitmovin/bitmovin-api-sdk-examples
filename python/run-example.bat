set file_name=%1
shift

pip3 install -r requirements.txt
python3 src\%file_name.py %*
