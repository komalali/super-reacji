import { WebClient, WebAPICallResult } from "@slack/web-api";

export async function getUser(client: WebClient, userId: string) {
    return client.users.info({ user: userId });
}

interface UserInfoResult extends WebAPICallResult {
    user: {
        profile: {
            email: string;
        };
    };
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
