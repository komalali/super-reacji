import * as aws from "@pulumi/aws";

export async function getSSMParam(paramName: string, isSecret: boolean) {
    const ssm = new aws.sdk.SSM();
    const ssmResult = await ssm
        .getParameter({
            Name: paramName,
            WithDecryption: isSecret,
        })
        .promise();
    return ssmResult.Parameter?.Value;
}
