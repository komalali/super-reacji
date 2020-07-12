import { WebClient, WebAPICallResult } from "@slack/web-api";
import { ParsedUrlQuery } from "querystring";
import { getSSMParam } from "./aws";

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

async function getAllowList(allowListParam: string) {
    // TODO: fetch allowListParam and parse the output.
    const domains = ["pulumi.com"];
    const emails = ["komalsali@gmail.com"];
    return {
        domains,
        emails,
    };
}

export async function checkIfUserIsApproved(
    client: WebClient,
    userId: string,
    allowListParamName: string
) {
    const userInfo = (await getUser(client, userId)) as UserInfoResult;
    if (userInfo.ok) {
        const { email } = userInfo.user.profile;
        const emailDomain = email.split("@")[1];

        const allowList = await getAllowList(allowListParamName);
        const domainIsAllowed = allowList.domains.includes(emailDomain);
        const emailIsAllowed = allowList.emails.includes(email);

        return domainIsAllowed || emailIsAllowed;
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
    const slackSecret = await getSSMParam(tokenName, true);
    if (!slackSecret) throw new Error("no slack token");

    return new WebClient(slackSecret);
}

export async function getChannelId(client: WebClient, channelName: string) {
    const response = (await client.conversations.list({
        exclude_archived: true,
    })) as any;
    if (!response.ok) throw new Error(response.error);

    const targetChannel = response.channels.filter(
        (channel: any) => channel.name === channelName
    );
    console.log("targetChannel", targetChannel);
    if (!targetChannel.length) {
        throw new Error("No matching channel");
    }

    return targetChannel[0].id;
}
