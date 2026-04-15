<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Technitium DNS Companion backend notes

### Log Alerts SMTP configuration

The log alerts SMTP endpoints are available under `/api/nodes/log-alerts/*`.

Set these environment variables in your `.env`:

```dotenv
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=alerts@example.com
SMTP_PASS=app-password-or-smtp-password
SMTP_FROM=Technitium DNS Companion <alerts@example.com>
```

Optional variables:

```dotenv
SMTP_REPLY_TO=admin@example.com
```

### SMTP endpoint examples

Check SMTP configuration status:

```bash
curl -s http://localhost:3000/api/nodes/log-alerts/smtp/status
```

Send SMTP test email:

```bash
curl -s -X POST http://localhost:3000/api/nodes/log-alerts/smtp/test \
  -H 'Content-Type: application/json' \
  -d '{
    "to": ["admin@example.com"],
    "subject": "SMTP test from Technitium DNS Companion",
    "text": "If you received this, SMTP is configured correctly."
  }'
```

### Log alert rules storage (MVP)

Log alert rule management endpoints:

- `GET /api/nodes/log-alerts/rules/status`
- `GET /api/nodes/log-alerts/rules`
- `POST /api/nodes/log-alerts/rules`
- `PATCH /api/nodes/log-alerts/rules/:ruleId/enabled`
- `DELETE /api/nodes/log-alerts/rules/:ruleId`
- `GET /api/nodes/log-alerts/evaluator/status`
- `POST /api/nodes/log-alerts/evaluator/run`

Optional environment variables:

```dotenv
LOG_ALERT_RULES_ENABLED=true
LOG_ALERT_RULES_SQLITE_PATH=/data/log-alert-rules.sqlite
LOG_ALERTS_EVALUATOR_ENABLED=false
LOG_ALERTS_EVALUATOR_INTERVAL_MS=60000
LOG_ALERTS_EVALUATOR_LOOKBACK_SECONDS=900
LOG_ALERTS_EVALUATOR_MAX_ENTRIES_PER_PAGE=500
LOG_ALERTS_EVALUATOR_MAX_PAGES_PER_RUN=3
```

Create rule example:

```bash
curl -s -X POST http://localhost:3000/api/nodes/log-alerts/rules \
  -H 'Content-Type: application/json' \
  -d '{
    "rule": {
      "name": "Blocked ads for kid devices",
      "enabled": true,
      "outcomeMode": "blocked-only",
      "domainPattern": "*.ads.example.com",
      "domainPatternType": "wildcard",
      "clientIdentifier": "kid-tablet",
      "debounceSeconds": 900,
      "emailRecipients": ["admin@example.com"]
    }
  }'
```

Run evaluator manually (dry run):

```bash
curl -s -X POST http://localhost:3000/api/nodes/log-alerts/evaluator/run \
  -H 'Content-Type: application/json' \
  -d '{"dryRun":true}'
```

### SMTP troubleshooting

If SMTP test returns `535 5.7.0` (invalid login), check these first:

- Confirm provider-specific auth requirements (for example, app passwords when MFA is enabled).
- Verify `SMTP_USER` and `SMTP_PASS` are the exact SMTP credentials expected by your provider.
- Verify TLS mode matches port:
  - `SMTP_PORT=587` with `SMTP_SECURE=false` (STARTTLS)
  - `SMTP_PORT=465` with `SMTP_SECURE=true` (implicit TLS)
- Temporarily set `SMTP_FROM` to the same mailbox as `SMTP_USER` to isolate sender-identity restrictions.

Credential-change behavior:

- The backend caches the SMTP transporter for reuse.
- Changing SMTP settings that affect auth now invalidates that cache key, including `SMTP_PASS`.
- If needed, restart/recreate the backend container after `.env` changes to ensure all runtime state is refreshed.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
