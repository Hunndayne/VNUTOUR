#!/bin/sh
#
# Nạp dải IP Cloudflare vào các set của table inet vnutour_fw.
#
# Chạy hàng tuần bằng timer, và một lần nữa mỗi khi firewall khởi động. Cloudflare
# đổi dải rất hiếm, nhưng 443 chỉ nhận từ những dải này — danh sách lệch là site
# tắt, nên nó không nên là thứ gõ tay rồi quên.
#
# Bản tải được lần cuối giữ lại ở $CACHE và chính là thứ unit firewall nạp lúc
# boot, nên set không bao giờ rỗng vì mạng chưa lên. Mọi lỗi tải hay dữ liệu lạ
# đều thoát sớm và giữ nguyên set đang chạy: thà dùng danh sách cũ còn hơn tự
# xoá trắng đường vào duy nhất của site.
set -eu

CACHE=/var/lib/vnutour-fw/cloudflare.nft
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

V4=$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v4)
V6=$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v6)

# Một trang lỗi trả về 200 vẫn là "tải được". Kiểm tra hình dạng trước khi tin:
# mọi dòng phải là CIDR, và số dòng phải hợp lý so với thực tế (v4 khoảng 15
# dải, v6 khoảng 7).
check() {
	printf '%s\n' "$2" | grep -Ev "$3" | grep -q . && {
		echo "$1: có dòng không phải CIDR, bỏ qua lần cập nhật này" >&2
		exit 1
	}
	[ "$(printf '%s\n' "$2" | grep -c .)" -ge "$4" ] || {
		echo "$1: chỉ có $(printf '%s\n' "$2" | grep -c .) dòng, ít bất thường" >&2
		exit 1
	}
}

check ips-v4 "$V4" '^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$' 10
check ips-v6 "$V6" '^[0-9a-fA-F:]+/[0-9]{1,3}$' 5

{
	echo "flush set inet vnutour_fw cloudflare_v4"
	echo "add element inet vnutour_fw cloudflare_v4 { $(printf '%s\n' "$V4" | paste -sd, -) }"
	echo "flush set inet vnutour_fw cloudflare_v6"
	echo "add element inet vnutour_fw cloudflare_v6 { $(printf '%s\n' "$V6" | paste -sd, -) }"
} > "$TMP"

# Nạp trước, lưu sau: chỉ cache lại thứ nft đã chấp nhận, để lần boot sau không
# nạp một file mà chính nft từ chối.
nft -f "$TMP"
install -D -m 0644 "$TMP" "$CACHE"

echo "đã nạp $(printf '%s\n' "$V4" | grep -c .) dải v4 và $(printf '%s\n' "$V6" | grep -c .) dải v6"
