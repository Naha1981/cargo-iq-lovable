# CargoIQ Owner Runbook

For the NahaLabs owner (Thabiso). Plain steps only. Anything not listed here is not your job - it is Instinct's.

## The five things you may ever need to do

### 1. Publish a new version
Lovable project -> Publish button. Instinct cannot do this for you; the publish tap is always yours. After you publish, tell Instinct so the live site can be verified.

### 2. Run a database update
Instinct sends you a page with one Copy button.
1. Open lovable.dev and sign in.
2. Open the CargoIQ project.
3. Cloud tab -> Database -> SQL Editor. (If you cannot find it, ask Lovable: "open the SQL editor".)
4. Paste and press Run.
5. Send Instinct the result row. If it starts with OK it worked; if it says OWNER STEP STOPPED you are in the wrong project and nothing was changed.

Updates from Instinct are safe to run twice. Nothing in them deletes your data.

### 3. Set a company's daily free-AI limit
Admin panel (cargoiq.nahalabs.co.za/admin) -> "Free AI extraction - daily attempt limits".
- Type a number and Save. That business gets that many free extraction attempts per day.
- 0 turns free AI extraction off for that business only.
- A business with no number uses the global default (10).
- The global default is the emergency off: setting it to 0 in configuration turns free extraction off everywhere.

### 4. Turn free AI extraction off everywhere at once
Ask Instinct, or set the global default to 0 as above. No deploy needed; it applies immediately.

### 5. Check whether the app is healthy
Open cargoiq.nahalabs.co.za/admin. If the Platform overview shows business, user, case and dispute counts, the database is reachable and working. (A daily automated health email is planned - see the roadmap in the README.)

## What you never need to do
- Reset or share any password with anyone, including Instinct. Instinct will never ask.
- Pay for any AI provider. All current AI extraction runs on free providers until the first paying customer.
- Touch GitHub, servers, or environment settings.

## If something is wrong
Send Instinct a screenshot and what you clicked. Do not retry a failed sign-in more than once - tell Instinct instead.
