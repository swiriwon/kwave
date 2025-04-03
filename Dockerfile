FROM apify/actor-node-puppeteer-chrome:16-21.1.1
:contentReference[oaicite:4]{index=4}
# Copy your application files
:contentReference[oaicite:5]{index=5}
:contentReference[oaicite:6]{index=6}
# Install dependencies
:contentReference[oaicite:7]{index=7} \
    && (npm list || true)
:contentReference[oaicite:8]{index=8}
# Your additional Dockerfile instructions&#8203;:contentReference[oaicite:9]{index=9}
