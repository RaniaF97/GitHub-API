import bunyan  from 'bunyan';
import moment from 'moment';
import _ from 'lodash';
import { Octokit } from "octokit";
var log = bunyan.createLogger({name: "test-app"});

const owner = ''; //replace with github owner
const repo = ''; //replace with desired repo
const token = ''; //replace with valid token

const nextPattern = /(?<=<)([\S]*)(?=>; rel="Next")/i;
const octokit = new Octokit({ 
  auth: token,
});

let allPRs = [], totalOpened = 0, totalClosed = 0, pullRequestsOpenedInPastWeek = 0, pullRequestsStuckInReview = 0, pullRequestsClosedInPastWeek = 0, pullRequestsWithComplexChanges = 0, pullRequestsWithMinimalChanges = 0;

if(!owner?.length || !repo?.length || !token?.length){
  log.error("Error cannot get pull requests as missing required params: owner, repo or token");
}
else {
  //1. First get all of the pull requests in the repo - NOTE: this will get all pull requests ever created
  await _getPullRequests("/repos/{owner}/{repo}/pulls");
}

//2. For all the pull requests, parse through and get the required data
if(allPRs?.length){
  log.info(`Total number of pull requests ${allPRs.length}, going to parse through data now`)
  let todaysDate = moment();
  let aWeekAgo = moment().subtract(7, 'days').format('YYYY-MM-DD');
  let twoWeeksAgo = moment().subtract(14, 'days');

  for(var i = 0; i < allPRs.length; i++){
    let pr = allPRs[i];
    let {state, number} = pr;
    if(state === 'open') {
      totalOpened++
      let prCreatedAt = moment(pr.created_at);
      if(prCreatedAt.isBetween(aWeekAgo, todaysDate)) pullRequestsOpenedInPastWeek++; //prs open in past week
      if(prCreatedAt < twoWeeksAgo) pullRequestsStuckInReview++; //if a pull request was opened more than 2 weeks ago it is considered "old" and stuck in review for a long time
    }
    else if(state === 'closed') {
      totalClosed++;
      if(moment(pr.closed_at).isBetween(aWeekAgo, todaysDate)) pullRequestsClosedInPastWeek++; //prs closed in past week
    }

    //3. For each PR, check how many files have been changed to determine if it is a complex or minimal PR
    let {data} = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/files', {
      owner,
      repo,
      pull_number: number,
      headers: {
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    //if a PR has 10 files or more changed, it is complex, otherwise it is minimal
    if(data?.length >= 10) pullRequestsWithComplexChanges++;
    else if(data?.length < 10) pullRequestsWithMinimalChanges++;
  }

  log.info(`There are ${totalOpened} open and ${totalClosed} closed pull requests in the ${repo} repo`);
  log.info(`There were ${pullRequestsOpenedInPastWeek} pull requests opened and ${pullRequestsClosedInPastWeek} pull requests closed in the past week.`);
  log.info(`There are ${pullRequestsStuckInReview} pull requests that are stuck in review for a long time - i.e. in an open state for greater than 2 weeks.`);
  log.info(`From all pull requests created, ${pullRequestsWithComplexChanges} have many changes and ${pullRequestsWithMinimalChanges} have little changes`);
}
else log.info("No pull requests found for owner/repo specified");

async function _getPullRequests(url){
  log.info("Getting pull requests for repo...");
  const response = await octokit.request(`GET ${url}`, {
    per_page: 100,
    owner,
    repo,
    headers: {
      "X-GitHub-Api-Version": "2022-11-28",
    },
    state: 'all'
  });

  let {data} = response;
  let linkHeader = response.headers.link;

  if(data?.length) {
    allPRs = allPRs.concat(data);
  }

  //based on https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api?apiVersion=2022-11-28
  if(linkHeader?.includes(`rel=\"next\"`)){
    url = linkHeader.match(nextPattern)[0];
    await _getPullRequests(url);
  }

  return data;
}

