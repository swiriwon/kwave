# Use the official Apify base image with Node.js and Puppeteer
FROM apify/actor-node-puppeteer-chrome:18-21.1.0

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install project dependencies
RUN npm install --only=prod --no-optional --quiet && \
    npm list || true

# Copy the rest of your application's source code
COPY . .

# Command to run your application
CMD ["node", "your-script.js"]
