# Use the Apify actor node image as base
FROM apify/actor-node-puppeteer-chrome:18-21.1.0

USER root

# Clean old Crawlee if exists (make sure no conflicts)
RUN rm -rf /home/myuser/node_modules/crawlee

# Prepare the app folder and ensure correct ownership
RUN mkdir -p /home/myuser/app && chown -R myuser:myuser /home/myuser/app

WORKDIR /home/myuser/app

USER myuser

# Copy package.json and package-lock.json files for installing dependencies
COPY package*.json ./

# Install dependencies, including csv-writer and other packages listed in package.json
RUN npm install --quiet --omit=dev --no-optional && \
    npm install @crawlee/puppeteer@3.13.0 --force && \
    npm list || true

# Copy the rest of the application files to the container
COPY . .

# Set the command to run your app (main.js)
CMD ["sh", "-c", "NODE_PATH=./node_modules node main.js"]
