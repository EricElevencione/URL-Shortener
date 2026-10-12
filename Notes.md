docker start redis
docker ps -a
docker ps
docker exec -it redis redis-cli PING
59d34c8ab3b4bd9a4fe15ba2813b400e106586b697e3e1e826d7fb3a96289c19

- In the apps.ts file in the "app.get("/:shortCode"" part is we don't look if the shortCode is undefined like this "http://localhost:3000/links/" because that is not really undefined but not simply called

The difference between 301 and 302 is that 301 is permamnent and 302 is temporary. But for the browser to do that when someone sends GET /abc123 and it points to https://example.com the server can respond as "HTTP/1.1 302 Found
Location: https://example.com" then it turns into "return res.redirect(302, cachedUrl);"

So in updating the url for example is "https://example.com" -> "https://google.com" the redis will still catch on like below:
PostgreSQL
OsFxS2Et3u → https://google.com

Redis
link:OsFxS2Et3u → https://example.com ❌

So we have to update it like this:

1. Update PostgreSQL
   ↓
2. Delete Redis key
   ↓
3. Done
