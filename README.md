# super-reacji

This project allows you to deploy your own serverless [reacji-channeler](https://reacji-channeler.builtbyslack.com/) clone built using [Pulumi](https://www.pulumi.com/), AWS (API Gateway, Lambda and DynamoDB) and the [Slack API](https://api.slack.com/).

## Getting Started

### Prerequisites

To run this code, you must have:
* An AWS account and credentials.
* The Pulumi CLI and an account.
* A Slack App auth token.
* Node.js v10+

### Installation

Clone this repository and run `npm ci` to install dependencies. Then follow the steps below.

* Initialize your stack
```bash
pulumi stack init dev
```
* Set your region
```bash
pulumi config set aws:region <region>
```
* Set your Slack auth token
```bash
pulumi config set --secret slackToken <SlackToken>
```
* [Optional] Set the list of allowed email domains or addresses.
```bash
pulumi config set allowList <allowList>
```
> Note: allowList should be a comma-separated string, e.g. "pulumi.com,bob@burgers.com"
* Deploy the stack
```bash
pulumi up
```
* Choose `yes` to deploy.

## Built With

* Slack Events API: Capture reaction events
* Slack Web API: Get information / Post to channel
* [Pulumi:](https://www.pulumi.com) Infrastructure as Code
* API Gateway: Event ingestion / Slash command endpoints 
* Lambda: Event handler
* DynamoDB: Data storage
