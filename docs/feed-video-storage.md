# Feed video uploads

Admins can attach MP4 and WebM files to feed posts. The limit is 100 MiB
(104,857,600 bytes), displayed as 100 MB in the editor. Images retain their
existing limits. Videos play with native browser controls, without autoplay or
eager downloading. MP4 with H.264 is recommended for broad browser support;
the service stores originals and does not transcode unsupported codecs.

The browser starts an authenticated upload, sends sequential 8 MiB parts, then
completes it. This keeps individual requests below the Cloudflare proxy upload
limit. The server validates the declared file size, the actual size of each
part, the container signature, completeness and the final R2 object length and
content type. Completed files live under the dedicated `feed-videos/` prefix.
R2 and a public base URL are required; large videos do not fall back to pod disk.

`FeedVideo` tracks the generated storage key before starting the R2 multipart
upload. Only the uploader can attach an unassigned video, and a video belongs
to one post. An admin editing an existing post can keep or remove its videos.
Post updates/deletion and video uploads use database row locks to coordinate
with each other and with the cleanup job.

Removing an existing video takes effect when the post is saved. Deleting a
post also deletes its videos. Cleanup aborts outstanding multipart uploads,
deletes the object and verifies a missing-object response before deleting the
database record. R2 failures return HTTP 503 and retain tracking records for a
retry. A multi-video delete may have removed some objects before an error;
retrying the same operation is safe. Never manually delete tracking rows to
hide a storage error.

Canceling an upload or closing the editor cleans up unassigned videos. Closing
the browser or losing connectivity cannot reliably finish those requests, so
the hourly `feed-video-cleanup` CronJob removes unassigned uploads idle for
24 hours, including multipart sessions whose creation response was lost.
It retries failures on later runs. Attached drafts and published videos are
excluded. A manual pass is available via:

```sh
python webapi/manage.py cleanup_feed_videos
```

Required R2 permissions include multipart creation/upload/completion/listing/
abort plus object HEAD/DELETE. Objects are uploaded with `Cache-Control:
no-store` so cached copies do not outlive deletion in normal client/CDN flows.
