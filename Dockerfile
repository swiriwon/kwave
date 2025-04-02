FROM apify/actor-node-puppeteer-chrome

COPY . ./

RUN npm install --quiet --only=prod --no-optional \
 && (npm list || true)
