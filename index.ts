import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

import { handleEvent, handleNewRule } from "./src/handler";

const config = new pulumi.Config();
const token = config.requireSecret("slack_token");

const appName = "super-reacji";
const tokenParamName = `/${appName}/slack-token`;

function addSecretsManagerReadAccessPolicy(
    endpoint: string,
    method: awsx.apigateway.Method
) {
    const routeFunction = api.getFunction(endpoint, method);
    new aws.iam.RolePolicy(
        `${appName}-ssm-role-policy${endpoint.replace("/", "-")}`,
        {
            role: routeFunction.role.apply((roleArn) => roleArn.split("/")[1]),
            policy: JSON.stringify({
                Version: "2012-10-17",
                Statement: [
                    {
                        Action: ["ssm:GetParameter"],
                        Effect: "Allow",
                        Resource: "*",
                    },
                ],
            }),
        },
        { parent: api }
    );
}

function addDynamoPolicy(endpoint: string, method: awsx.apigateway.Method) {
    const routeFunction = api.getFunction(endpoint, method);
    new aws.iam.RolePolicy(
        `${appName}-dynamo-role-policy${endpoint.replace("/", "-")}`,
        {
            role: routeFunction.role.apply((roleArn) => roleArn.split("/")[1]),
            policy: JSON.stringify({
                Version: "2012-10-17",
                Statement: [
                    {
                        Action: [
                            "dynamodb:PutItem",
                            "dynamodb:DeleteItem",
                            "dynamodb:GetItem",
                        ],
                        Effect: "Allow",
                        Resource: "*",
                    },
                ],
            }),
        },
        { parent: api }
    );
}

const slackTokenSecretParam = new aws.ssm.Parameter(`${appName}-slack-token`, {
    type: aws.ssm.SecureStringParameter,
    description: "Slack token for super-reacji",
    value: token,
    name: tokenParamName,
});

const dedupeTable = new aws.dynamodb.Table(`${appName}-deduplication-table`, {
    hashKey: "messageId",
    ttl: {
        attributeName: "ttl",
        enabled: true,
    },
    attributes: [{ name: "messageId", type: "S" }],
    tags: {
        App: appName,
        Environment: "dev",
    },
    writeCapacity: 5,
    readCapacity: 5,
});

const ruleTable = new aws.dynamodb.Table(`${appName}-rule-table`, {
    hashKey: "emojiName",
    attributes: [{ name: "emojiName", type: "S" }],
    tags: {
        App: appName,
        Environment: "dev",
    },
    writeCapacity: 5,
    readCapacity: 5,
});

const api = new awsx.apigateway.API(
    `${appName}-ingest`,
    {
        routes: [
            {
                path: "/ingest",
                method: "POST",
                eventHandler: new aws.lambda.CallbackFunction(
                    `${appName}-function`,
                    {
                        timeout: 10,
                        environment: {
                            variables: {
                                DEDUPE_TABLE_NAME: dedupeTable.name,
                                RULE_TABLE_NAME: ruleTable.name,
                                TOKEN_PARAM_NAME: tokenParamName,
                            },
                        },
                        callback: handleEvent,
                    }
                ),
            },
            {
                path: "/rule",
                method: "POST",
                eventHandler: new aws.lambda.CallbackFunction(
                    `${appName}-new-rule`,
                    {
                        timeout: 10,
                        environment: {
                            variables: {
                                RULE_TABLE_NAME: ruleTable.name,
                                TOKEN_PARAM_NAME: tokenParamName,
                            },
                        },
                        callback: handleNewRule,
                    }
                ),
            },
        ],
    },
    { dependsOn: [slackTokenSecretParam, dedupeTable, ruleTable] }
);

addSecretsManagerReadAccessPolicy("/ingest", "POST");
addSecretsManagerReadAccessPolicy("/rule", "POST");
addDynamoPolicy("/ingest", "POST");
addDynamoPolicy("/rule", "POST");

// Export the name of the bucket
export const endpoint = api.url;
