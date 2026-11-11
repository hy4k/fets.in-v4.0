FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html robots.txt favicon.svg enhancements.css enhancements.js support.css support.js /usr/share/nginx/html/
COPY assets /usr/share/nginx/html/assets
COPY images /usr/share/nginx/html/images
COPY support /usr/share/nginx/html/support
COPY open-days /usr/share/nginx/html/open-days
