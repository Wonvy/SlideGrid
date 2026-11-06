#!/bin/bash
# 双击启动 SlideGrid 本地服务并打开浏览器
cd "$(dirname "$0")"
PORT=5318
(sleep 1 && open "http://localhost:$PORT") &
echo "SlideGrid 已启动：http://localhost:$PORT （关闭此窗口即停止）"
python3 serve.py $PORT
