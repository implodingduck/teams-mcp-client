#!/bin/bash
docker build -t teamsbot .

docker stop teamsbot
docker rm teamsbot

docker run -d --env-file .env -p 3978:3978 --name teamsbot teamsbot
