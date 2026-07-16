# Issue tracker: GitHub

Issues và PRD của repo được quản lý bằng GitHub Issues. Dùng `gh` CLI cho các thao tác với issue.

## Conventions

- Tạo issue: `gh issue create --title "..." --body "..."`
- Đọc issue: `gh issue view <number> --comments`
- Liệt kê issue: `gh issue list --state open --json number,title,body,labels,comments`
- Bình luận: `gh issue comment <number> --body "..."`
- Thêm hoặc xóa nhãn: `gh issue edit <number> --add-label "..."` hoặc `--remove-label "..."`
- Đóng issue: `gh issue close <number> --comment "..."`

Repo được suy ra từ `git remote -v`; khi chạy trong clone này, `gh` tự chọn `Hunndayne/VNUTOUR`.

## Khi skill yêu cầu publish

Khi một skill yêu cầu “publish to the issue tracker”, hãy tạo GitHub issue.

## Khi skill yêu cầu đọc ticket

Chạy `gh issue view <number> --comments` và đọc cả nội dung, bình luận, nhãn.
