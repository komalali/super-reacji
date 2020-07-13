import { parse } from "querystring";
import * as aws from "@pulumi/aws";
import {
    checkIfUserIsApproved,
    getChannelId,
    getMessagePermalink,
    getSlackClient,
    parseCommand,
    SlashCommandInput,
} from "./slack";
import { WebClient } from "@slack/web-api";

function getEnvVars() {
    const dedupeTable = process.env.DEDUPE_TABLE_NAME || "";
    const ruleTable = process.env.RULE_TABLE_NAME || "";
    const tokenParamName = process.env.TOKEN_PARAM || "";
    const allowListParamName = process.env.ALLOW_LIST_PARAM || "";

    return {
        dedupeTable,
        ruleTable,
        tokenParamName,
        allowListParamName,
    };
}

interface ApiProxyEvent {
    body: string;
    isBase64Encoded: boolean;
}

export async function handleEvent(event: ApiProxyEvent) {
    const {
        dedupeTable,
        ruleTable,
        tokenParamName,
        allowListParamName,
    } = getEnvVars();

    if (!event.body) {
        return {
            statusCode: 400,
            body: "400 bad request",
        };
    }

    let jsonBody = Buffer.from(event.body, "base64").toString("utf8");
    const body = JSON.parse(jsonBody);
    console.log("body", body);

    if (body.challenge) {
        return {
            statusCode: 200,
            body: body.challenge,
        };
    }

    const {
        user,
        reaction: emoji,
        item: { channel, ts: timestamp },
    } = body?.event;
    if (!(user && emoji && channel && timestamp)) {
        return {
            statusCode: 400,
            body: "400 bad request",
        };
    }

    const messageId = `${emoji}-${channel}-${timestamp}`;
    const dynamo = new aws.sdk.DynamoDB();
    try {
        await dynamo
            .putItem({
                TableName: dedupeTable,
                Item: {
                    messageId: { S: messageId },
                    ttl: { N: String(Math.floor(Date.now() / 1000) + 600) },
                },
                ConditionExpression: "attribute_not_exists(messageId)",
            })
            .promise();
        console.log("First time seeing this message, adding to table.");
    } catch (err) {
        if (err.code != "ConditionalCheckFailedException") {
            await dynamo
                .deleteItem({
                    TableName: dedupeTable,
                    Key: {
                        messageId: { S: messageId },
                    },
                })
                .promise();
            throw err;
        }
        console.log("Message already exists, returning early.");
        return {
            statusCode: 200,
            body: "success",
        };
    }

    let web: WebClient;
    let userIsApproved: boolean;

    try {
        web = await getSlackClient(tokenParamName);
        userIsApproved = await checkIfUserIsApproved(
            web,
            user,
            allowListParamName
        );
    } catch (err) {
        console.log(err);
        return {
            statusCode: 500,
            body: "something went wrong",
        };
    }

    if (userIsApproved) {
        try {
            const response = (await dynamo
                .getItem({
                    TableName: ruleTable,
                    Key: {
                        emojiName: {
                            S: emoji,
                        },
                    },
                })
                .promise()) as any;
            const channelId = response.Item.channelId.S;

            const messageLinkResponse = await getMessagePermalink(
                web,
                channel,
                timestamp
            );
            console.log("messageLinkResponse", messageLinkResponse);

            if (messageLinkResponse.ok) {
                const response = await web.chat.postMessage({
                    text: String(messageLinkResponse.permalink),
                    channel: channelId,
                });
                console.log("chatResponse", response);
            }
        } catch (err) {
            if (err.code === "ResourceNotFoundException") {
                console.log("No rule for this emoji, exiting.");
                return {
                    statusCode: 200,
                    body: "success",
                };
            }
        }
    }

    return {
        statusCode: 200,
        body: "success",
    };
}

export async function handleNewRule(event: ApiProxyEvent) {
    const { ruleTable, tokenParamName } = getEnvVars();

    if (!event.body) {
        return {
            statusCode: 400,
            body: "400 bad request",
        };
    }

    const body = parse(event.body) as SlashCommandInput;
    Object.entries(body).forEach(([key, value]) => {
        body[key] = String(value).replace("\n", "");
    });
    console.log("body", body);

    const { emoji, channelName } = parseCommand(body);
    const web = await getSlackClient(tokenParamName);

    return processNewRuleRequest(emoji, channelName, ruleTable, web);
}

async function processNewRuleRequest(
    emoji: string,
    channelName: string,
    tableName: string,
    slackClient: WebClient
) {
    let channelId;
    try {
        channelId = await getChannelId(slackClient, channelName);
    } catch (err) {
        console.log(err);
        return {
            statusCode: 404,
            body: err,
        };
    }

    const dynamo = new aws.sdk.DynamoDB();
    try {
        await dynamo
            .putItem({
                TableName: tableName,
                Item: {
                    emojiName: { S: emoji },
                    channelId: { S: channelId },
                },
                ConditionExpression: "attribute_not_exists(emojiName)",
            })
            .promise();
        const message = `Adding new rule to table: {emoji: ${emoji}, channel: ${channelName}}.`;
        console.log(message);
        return {
            statusCode: 200,
            body: message,
        };
    } catch (err) {
        if (err.code != "ConditionalCheckFailedException") {
            throw err;
        }
        const message = `There is an existing rule for the :${emoji}: emoji, try again.`;
        console.log(message);
        return {
            statusCode: 400,
            body: message,
        };
    }
}
