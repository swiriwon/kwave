FROM apify/actor-node-puppeteer-chrome:18-21.1.0

USER root
RUN mkdir -p /home/myuser/app && chown -R myuser:myuser /home/myuser/app

WORKDIR /home/myuser/app
USER myuser

COPY package*.json ./

# ✅ Clean install of exact versions we need
RUN npm install --quiet --omit=dev --no-optional && \
    npm install @crawlee/puppeteer@3.13.0 --force && \
    npm list || true

COPY . .

CMD ["sh", "-c", "NODE_PATH=./node_modules node main.js"]

LABEL com.apify.actBuildId=manual-fix
