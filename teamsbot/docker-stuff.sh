docker build -t secure-bot-service .

docker stop secure-bot-service
docker rm secure-bot-service

docker run --env-file .env -p 3978:3978 --name secure-bot-service secure-bot-service
