FROM apify/actor-node-puppeteer-chrome:18-21.1.0

USER root

# Clean old Crawlee if exists
RUN rm -rf /home/myuser/node_modules/crawlee

# Prepare app folder
RUN mkdir -p /home/myuser/app && chown -R myuser:myuser /home/myuser/app

WORKDIR /home/myuser/app

USER myuser

COPY package*.json ./

# Clean install with correct versions
RUN npm install --quiet --omit=dev --no-optional && \
    npm install @crawlee/puppeteer@3.13.0 --force && \
    npm list || true

COPY . .

CMD ["sh", "-c", "NODE_PATH=./node_modules node main.js"]
