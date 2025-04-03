FROM apify/actor-node-puppeteer-chrome:16-21.1.1

# Set the working directory inside the container
WORKDIR /app

# Copy your application files into the container
COPY . ./

# Install dependencies
RUN npm install --quiet --only=prod --no-optional \
    && (npm list || true)

# Specify the command to run your application
CMD ["node", "main.js"]
