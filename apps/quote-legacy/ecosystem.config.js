// pm2 배포 설정 — Linux 서버
// 사용: pm2 start ecosystem.config.js --env production
module.exports = {
  apps: [
    {
      name: 'sepoa-quote',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '300M',
      watch: false,
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      // .env 파일은 dotenv가 로드하므로 여기서 별도 주입하지 않는다.
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
