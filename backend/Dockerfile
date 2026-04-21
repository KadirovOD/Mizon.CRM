FROM node:18-alpine

WORKDIR /app

# Install dependencies first for caching layers
COPY package*.json ./
RUN npm install

# Do not copy everything immediately because we mount ./backend:/app in dev
# The command starts `npm run dev`

EXPOSE 3000
CMD ["npm", "run", "dev"]
