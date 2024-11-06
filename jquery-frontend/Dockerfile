FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY elastic-apm-rum.umd.min.js /usr/share/nginx/html/elastic-apm-rum.umd.min.js
COPY index.html /usr/share/nginx/html/index.html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"] 