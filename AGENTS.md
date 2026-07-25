# Local Docs

- GitHub repository webhooks (verified 2026-07-25): repository hooks can subscribe to both `push` and `pull_request`; PR preview lifecycle should react to opened/reopened/synchronize and closed deliveries. Context7: `/websites/github_en_rest`.
- Azure DevOps Service Hooks and PR statuses (API 7.1, verified 2026-07-25): use `git.pullrequest.created` plus `git.pullrequest.updated`; payloads expose `pullRequestId`, `status`, `sourceRefName`, `lastMergeSourceCommit.commitId`, and repository/project coordinates. Publish preview links with `POST .../pullRequests/{id}/statuses?api-version=7.1`; posting the same `context.genre` + `context.name` updates that logical status. Context7: `/microsoftdocs/azure-devops-docs`, `/websites/learn_microsoft_en-us_rest_api_azure_devops`.
