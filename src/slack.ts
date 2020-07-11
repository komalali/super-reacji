import { WebClient, WebAPICallResult } from "@slack/web-api";
import { ParsedUrlQuery } from "querystring";
import * as aws from "@pulumi/aws";

interface UserInfoResult extends WebAPICallResult {
    user: {
        profile: {
            email: string;
        };
    };
}

export interface SlashCommandInput extends ParsedUrlQuery {
    command: string;
    text: string;
    user_id: string;
    channel_id: string;
    response_url: string;
}

export async function getUser(client: WebClient, userId: string) {
    return client.users.info({ user: userId });
}

export async function checkIfUserIsApproved(client: WebClient, userId: string) {
    const userInfo = (await getUser(client, userId)) as UserInfoResult;
    if (userInfo.ok) {
        const { email } = userInfo.user.profile;
        const emailDomain = email.split("@")[1];
        return emailDomain === "pulumi.com" || email === "komalsali@gmail.com";
    }
    return false;
}

export async function getMessagePermalink(
    client: WebClient,
    channelId: string,
    timestamp: string
) {
    return client.chat.getPermalink({
        channel: channelId,
        message_ts: timestamp,
    });
}

export function parseCommand(input: SlashCommandInput) {
    const { text } = input;
    const [emoji, escapedChannelName] = text.split(" ");

    let channelName: string;
    if (escapedChannelName[0] === "<") {
        channelName = escapedChannelName.split("|")[1];
        channelName = channelName.replace(">", "");
    } else {
        channelName = escapedChannelName;
    }

    return { emoji, channelName };
}

export async function getSlackClient(tokenName: string) {
    const ssm = new aws.sdk.SSM();
    const ssmResult = await ssm
        .getParameter({
            Name: tokenName,
            WithDecryption: true,
        })
        .promise();
    const slackSecret = ssmResult.Parameter?.Value;

    return new WebClient(slackSecret);
}

export async function getChannelId(client: WebClient, channelName: string) {
    const response = (await client.conversations.list({
        exclude_archived: true,
    })) as any;
    const targetChannel = response.channels.filter(
        (channel: any) => channel.name === channelName
    );
    console.log("targetChannel", targetChannel);
    if (!targetChannel.length) {
        throw new Error("No matching channel");
    }

    return targetChannel[0].id;
}
