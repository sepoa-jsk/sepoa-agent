'use strict';
require('dotenv').config();

const express = require('express');

const blogApp = require('./blog-automation/web-console/server');
const quoteApp = require('./quote/server');

const app = express();
const PORT = Number(process.env.GATEWAY_PORT) || 8080;

app.get('/', (req, res) => {
  res.type('html').send(
    '<h1>Sepoa Agent</h1><ul>' +
      '<li><a href="/blog/">블로그 자동화 콘솔</a></li>' +
      '<li><a href="/quote/">견적 시스템</a></li>' +
      '</ul>'
  );
});

app.use('/blog', blogApp);
app.use('/quote', quoteApp);

app.listen(PORT, () => {
  console.log('\n[Sepoa Agent 통합 서버 실행 중]');
  console.log('  루트:   http://localhost:' + PORT + '/');
  console.log('  블로그: http://localhost:' + PORT + '/blog/');
  console.log('  견적:   http://localhost:' + PORT + '/quote/\n');
});