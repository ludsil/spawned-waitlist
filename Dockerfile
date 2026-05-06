FROM oven/bun:1

WORKDIR /app

COPY package.json server.ts ./
COPY public ./public

ENV PORT=3000
ENV DB_PATH=/data/waitlist.db
EXPOSE 3000

CMD ["bun", "server.ts"]
