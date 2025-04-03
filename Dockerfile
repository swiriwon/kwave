FROM apify/actor-node-puppeteer-chrome

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies with the specific Puppeteer version
RUN npm install puppeteer@21.1.1

# Copy the rest of your application code
COPY . .

# Command to run your application
CMD ["node", "your-script.js"]
