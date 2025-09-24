docker build -t teams-mcp-client .

docker stop teams-mcp-client
docker rm teams-mcp-client

docker run --env-file .env -p 3978:3978 --name teams-mcp-client teams-mcp-client
