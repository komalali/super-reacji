import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

import { handleEvent } from "./src/handler";

const config = new pulumi.Config();
const token = config.requireSecret("slack_token");

const appName = "super-reacji";
export const tokenParamName = `/${appName}/slack-token`;

function addSecretsManagerReadAccessPolicy(
    endpoint: string,
    method: awsx.apigateway.Method
) {
    const routeFunction = api.getFunction(endpoint, method);
    new aws.iam.RolePolicy(
        `${appName}-ssm-role-policy`,
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
        `${appName}-dynamo-role-policy`,
        {
            role: routeFunction.role.apply((roleArn) => roleArn.split("/")[1]),
            policy: JSON.stringify({
                Version: "2012-10-17",
                Statement: [
                    {
                        Action: ["dynamodb:PutItem", "dynamodb:DeleteItem"],
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
                                TABLE_NAME: dedupeTable.name,
                            },
                        },
                        callback: handleEvent,
                    }
                ),
            },
        ],
    },
    { dependsOn: [slackTokenSecretParam, dedupeTable] }
);

addSecretsManagerReadAccessPolicy("/ingest", "POST");
addDynamoPolicy("/ingest", "POST");

// Export the name of the bucket
export const endpoint = api.url;
