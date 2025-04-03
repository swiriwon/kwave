# Use the base image with Node.js 18 and Puppeteer 21.1.0
FROM apify/actor-node-puppeteer-chrome:18-21.1.0

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install the specific version of Puppeteer
RUN npm install puppeteer@21.1.1

# Copy the rest of your application's source code
COPY . .

# Command to run your application
CMD ["node", "main.js"]
