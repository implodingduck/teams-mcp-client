FROM node:22

RUN apt-get update && apt-get install -y tcpdump

WORKDIR /app

COPY package.json /app/package.json

RUN npm install

COPY . /app

RUN npm run build

EXPOSE 3978

ENTRYPOINT [ "/app/entry.sh" ]
