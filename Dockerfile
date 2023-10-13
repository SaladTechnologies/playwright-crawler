FROM node:18-slim

# Create app directory
WORKDIR /app

COPY *.json .
RUN npm clean-install
RUN npx playwright install --with-deps chromium

COPY *.js .

CMD [ "node", "index.js" ]
