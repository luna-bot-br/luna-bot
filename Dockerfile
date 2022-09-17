FROM node:16-bullseye as ts-compiler

WORKDIR /usr/app

COPY package*.json ./

COPY tsconfig*.json ./

RUN npm i

COPY . ./

RUN npm run build

FROM node:16-bullseye as ts-remover

WORKDIR /usr/app

COPY --from=ts-compiler /usr/app/package*.json ./
COPY --from=ts-compiler /usr/app/dist ./

RUN npm install --omit=dev

FROM node:16-bullseye

RUN apt update \
    && apt install -y \
    bzip2 \
    build-essential \
    chrpath \
    libssl-dev \
    libxft-dev

WORKDIR /usr/app

COPY --from=ts-remover /usr/app ./

EXPOSE 5003

CMD ["npm", "run" ,"start"]