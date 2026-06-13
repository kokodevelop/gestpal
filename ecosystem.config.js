module.exports = {
  apps: [
    {
      name: 'gestpal-server',
      script: 'src/server.js',
      cwd: __dirname,
      watch: false,
      restart_delay: 3000,
      max_restarts: 10,
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'gestpal-bridge',
      script: 'bridge.js',
      cwd: require('path').join(__dirname, 'scale-bridge'),
      watch: false,
      restart_delay: 5000,   // laisse le temps au port série de se libérer
      max_restarts: 50,      // tolérant : le port peut être occupé plusieurs fois de suite
      autorestart: true      // redémarre sur TOUT exit (crash, config reload, etc.)
    }
  ]
};
