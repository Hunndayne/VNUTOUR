"""Reusable branded email layout.

`api/email_templates/registration_confirmation.html` is the approved VNUTour
brand template (dark navy body, white content card, header/biểu trưng images,
footer contact block). `render_branded_email()` extracts that layout into a
reusable shell with a content slot, so every transactional email (password
reset now, registration confirmation later) shares one look instead of each
call site copy-pasting the table markup.

Plain Python string substitution is used rather than Django's template engine
— the layout has no conditionals/loops, and `str.replace` sidesteps the curly
braces already present in the `<style>` block's media queries, which would
collide with `str.format()`.
"""

from __future__ import annotations

from django.utils.html import escape

# Same brand assets as email_templates/registration_confirmation.html.
_HEADER_IMAGE_URL = "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEj-F2vvVtOhXRCuBgBh3zrIf_GLCUjgBGW1ghC7_ga4RuJUVzBnhxykvaOSulXQ1hAZs4kOxnG1oBqPKpKvXFikYXOcNKl-f_WFrTjman472c1VlHtq_bb2iS-8-_I8BfHG5MMzPZ8559p_x4HSyzqCvWQob6dSPIMA7Yd1UYoogx0JF4clTb56EzREMdo/s1600/PhoneHeader.png"
_CREST_IMAGE_URL = "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEgr1sV9iF0WJ7xGivas3L6kYoIQK4A2j-UH1hErlftEDWlE7HWo0x29_d-QbTmpukTc7nSMJiMLsE9_voKUQJF-mN_C04VP2_a7wyUduDHKRRSeXD8kn17eeCVi2DPUfk2-WOsHG_c8APtKBv-S54SWnnJ6b6CVooRiYSmN8Uyqjeebmw8aO38RlWN67QQ/s1600/BieuTrung%20%281%29.png"
_LOGO_IMAGE_URL = "https://storage.hiseku.net/logo.png"

_LAYOUT = """<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="vi">
  <head>
    <meta content="width=device-width, initial-scale=1" name="viewport" />
    <meta charset="UTF-8" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta content="telephone=no" name="format-detection" />
    <title>__SUBJECT__</title>
    <!--[if (mso 16)]>
      <style type="text/css">a { text-decoration: none; }</style>
    <![endif]-->
    <!--[if gte mso 9]>
      <noscript>
        <xml>
          <o:OfficeDocumentSettings>
            <o:AllowPNG></o:AllowPNG>
            <o:PixelsPerInch>96</o:PixelsPerInch>
          </o:OfficeDocumentSettings>
        </xml>
      </noscript>
    <![endif]-->
    <style type="text/css">
      #outlook a { padding: 0; }
      a[x-apple-data-detectors] {
        color: inherit !important;
        text-decoration: none !important;
        font-size: inherit !important;
        font-family: inherit !important;
        font-weight: inherit !important;
        line-height: inherit !important;
      }
      @media only screen and (max-width: 600px) {
        h1 { font-size: 30px !important; text-align: center; }
        .cb table, .cc table, .cb, .cc { width: 100% !important; max-width: 600px !important; }
        .adapt-img { width: 100% !important; height: auto !important; }
      }
    </style>
  </head>
  <body style="width: 100%; font-family: arial, 'helvetica neue', helvetica, sans-serif; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; padding: 0; margin: 0;">
    <div dir="ltr" lang="vi" style="background-color: #cfe2f3">
      <table width="100%" cellspacing="0" cellpadding="0" role="none" style="border-collapse: collapse; border-spacing: 0px; padding: 0; margin: 0; width: 100%; background-color: #cfe2f3;">
        <tr>
          <td valign="top" style="padding: 0; margin: 0">
            <table cellpadding="0" cellspacing="0" class="cc" align="center" role="none" style="border-collapse: collapse; border-spacing: 0px; table-layout: fixed !important; width: 100%;">
              <tr>
                <td align="center" style="padding: 0; margin: 0">
                  <table bgcolor="#ffffff" align="center" cellpadding="0" cellspacing="0" role="none" style="border-collapse: collapse; border-spacing: 0px; background-color: #ffffff; width: 550px;">
                    <tr>
                      <td align="left" bgcolor="#1F2c4d" style="padding: 0; margin: 0; background-color: #1f2c4d">
                        <table cellpadding="0" cellspacing="0" width="100%" role="none" style="border-collapse: collapse; border-spacing: 0px;">
                          <tr>
                            <td align="center" valign="top" style="padding: 0; margin: 0; width: 550px">
                              <table cellpadding="0" cellspacing="0" width="100%" role="presentation" style="border-collapse: collapse; border-spacing: 0px;">
                                <tr>
                                  <td align="center" style="padding: 10px; margin: 0; font-size: 0px;">
                                    <img src="__HEADER_IMAGE_URL__" alt="" style="display: block; border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic;" width="294" height="59" />
                                  </td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            <table cellspacing="0" cellpadding="0" class="cb" align="center" role="none" style="border-collapse: collapse; border-spacing: 0px; table-layout: fixed !important; width: 100%;">
              <tr>
                <td align="center" style="padding: 0; margin: 0">
                  <table style="border-collapse: collapse; border-spacing: 0px; background-color: #1f2c4d; width: 550px;" cellspacing="0" cellpadding="0" bgcolor="#1f2c4d" align="center" role="none">
                    <tr>
                      <td align="left" style="padding: 0; margin: 0">
                        <table width="100%" cellspacing="0" cellpadding="0" role="none" style="border-collapse: collapse; border-spacing: 0px;">
                          <tr>
                            <td valign="top" align="center" style="padding: 0; margin: 0; width: 550px">
                              <table width="100%" cellspacing="0" cellpadding="0" role="presentation" style="border-collapse: collapse; border-spacing: 0px;">
                                <tr>
                                  <td align="center" style="padding: 0; margin: 0; font-size: 0px;">
                                    <img class="adapt-img" src="__CREST_IMAGE_URL__" alt="" style="display: block; border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic;" width="220" height="220" />
                                  </td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            <table cellpadding="0" cellspacing="0" class="cb" align="center" role="none" style="border-collapse: collapse; border-spacing: 0px; table-layout: fixed !important; width: 100%;">
              <tr>
                <td align="center" style="padding: 0; margin: 0">
                  <table bgcolor="#1f2c4d" align="center" cellpadding="0" cellspacing="0" style="border-collapse: collapse; border-spacing: 0px; background-color: #1f2c4d; width: 550px;" role="none">
                    <tr>
                      <td align="left" style="padding: 0; margin: 0; padding-top: 20px; padding-left: 20px; padding-right: 20px;">
                        <table cellpadding="0" cellspacing="0" width="100%" role="none" style="border-collapse: collapse; border-spacing: 0px;">
                          <tr>
                            <td align="center" valign="top" style="padding: 0; margin: 0; width: 510px">
                              <table cellpadding="0" cellspacing="0" width="100%" role="presentation" style="border-collapse: collapse; border-spacing: 0px;">
                                <tr>
                                  <td style="padding: 0; margin: 0; border-bottom: 4px solid #ffffff; height: 0px; width: 100%;"></td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                    <tr>
                      <td align="left" bgcolor="#1f2c4d" style="padding: 0; margin: 0; padding-top: 20px; padding-left: 20px; padding-right: 20px; background-color: #1f2c4d;">
                        <table cellpadding="0" cellspacing="0" width="100%" role="none" style="border-collapse: collapse; border-spacing: 0px;">
                          <tr>
                            <td align="center" valign="top" style="padding: 0; margin: 0; width: 510px">
                              <table cellpadding="0" cellspacing="0" width="100%" role="presentation" style="border-collapse: collapse; border-spacing: 0px;">
                                <tr>
                                  <td bgcolor="#ffffff" style="margin: 0; padding-top: 10px; padding-bottom: 10px; padding-left: 20px; padding-right: 20px;">
                                    <h1 style="margin: 0; line-height: 43.2px; mso-line-height-rule: exactly; font-family: arial, 'helvetica neue', helvetica, sans-serif; font-size: 32px; font-style: normal; font-weight: normal; color: #09132c; text-align: center;">
                                      <strong>__TITLE__</strong>
                                    </h1>
                                    <p style="margin: 0; line-height: 16.8px; font-size: 14px;"><br /></p>
                                    __BODY__
                                  </td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                    __CTA_ROW__
                    <tr>
                      <td align="left" style="padding: 0; margin: 0; padding-top: 20px; padding-left: 20px; padding-right: 20px;">
                        <!--[if mso]><table style="width:510px" cellpadding="0" cellspacing="0"><tr><td style="width:327px" valign="top"><![endif]-->
                        <table cellpadding="0" cellspacing="0" align="left" role="none" style="border-collapse: collapse; border-spacing: 0px; float: left;">
                          <tr>
                            <td valign="top" align="center" style="padding: 0; margin: 0; width: 327px">
                              <table cellpadding="0" cellspacing="0" width="100%" role="presentation" style="border-collapse: collapse; border-spacing: 0px;">
                                <tr>
                                  <td align="left" style="padding: 5px; margin: 0">
                                    <p style="margin: 0; line-height: 22.5px; color: #ffffff; font-size: 15px; font-family: arial, 'helvetica neue', helvetica, sans-serif;">
                                      Mọi thắc mắc xin vui lòng liên hệ qua:
                                    </p>
                                    <ul>
                                      <li style="line-height: 24px; margin-bottom: 15px; margin-left: 0; color: #ffffff; font-size: 16px;">
                                        <strong><a target="_blank" style="text-decoration: underline; color: #f0f8ff; font-size: 15px; font-family: arial, 'helvetica neue', helvetica, sans-serif; line-height: 22.5px;" href="https://www.facebook.com/uit.nc">Khoa Mạng Máy tính &amp; Truyền thông&nbsp;</a></strong>
                                      </li>
                                      <li style="line-height: 24px; margin-bottom: 15px; margin-left: 0; color: #ffffff; font-size: 16px;">
                                        <strong><a target="_blank" style="text-decoration: underline; color: #f0f8ff; font-size: 15px; font-family: arial, 'helvetica neue', helvetica, sans-serif; line-height: 22.5px;" href="mailto:vnutour@suctremmt.com">VNU Tour</a></strong>
                                      </li>
                                    </ul>
                                  </td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                        <!--[if mso]></td><td style="width:20px"></td><td style="width:163px" valign="top"><![endif]-->
                        <table cellpadding="0" cellspacing="0" align="right" role="none" style="border-collapse: collapse; border-spacing: 0px; float: right;">
                          <tr>
                            <td align="left" style="padding: 0; margin: 0; width: 90px">
                              <table cellpadding="0" cellspacing="0" width="100%" role="presentation" style="border-collapse: collapse; border-spacing: 0px;">
                                <tr>
                                  <td align="center" style="padding: 0; margin: 0; font-size: 0px;">
                                    <img src="__LOGO_IMAGE_URL__" alt="" style="display: block; border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic;" width="80" height="80" />
                                  </td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                        <!--[if mso]></td></tr></table><![endif]-->
                      </td>
                    </tr>
                    <tr>
                      <td align="center" bgcolor="#1f2c4d" style="padding: 4px 20px 20px; margin: 0; background-color: #1f2c4d;">
                        <p style="margin: 0; line-height: 18px; color: #9fb0d0; font-size: 12px; font-style: italic; font-family: arial, 'helvetica neue', helvetica, sans-serif; text-align: center;">
                          Đây là email tự động từ hệ thống, mọi phản hồi trên email này sẽ không được hỗ trợ. Nếu cần hỗ trợ vui lòng liên hệ qua <a href="mailto:vnutour@suctremmt.com" style="color: #cfe2f3; text-decoration: underline;">vnutour@suctremmt.com</a>.
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  </body>
</html>
"""

# Bulletproof (Outlook-safe) CTA button: VML roundrect for mso, a plain
# table-based button everywhere else. Navy fill on white to match the brand.
_CTA_ROW = """
                    <tr>
                      <td align="center" bgcolor="#1f2c4d" style="padding: 4px 20px 24px; margin: 0; background-color: #1f2c4d;">
                        <!--[if mso]>
                        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="__CTA_URL__" style="height:46px;v-text-anchor:middle;width:260px;" arcsize="12%" stroke="f" fillcolor="#ffffff">
                        <w:anchorlock/>
                        <center style="color:#1f2c4d;font-family:arial,sans-serif;font-size:16px;font-weight:bold;">__CTA_LABEL__</center>
                        </v:roundrect>
                        <![endif]-->
                        <!--[if !mso]><!-- -->
                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin: 0 auto; border-collapse: collapse;">
                          <tr>
                            <td align="center" bgcolor="#ffffff" style="border-radius: 6px;">
                              <a href="__CTA_URL__" target="_blank" style="display: inline-block; padding: 14px 32px; font-family: arial, 'helvetica neue', helvetica, sans-serif; font-size: 16px; font-weight: bold; color: #1f2c4d; text-decoration: none; border-radius: 6px; background-color: #ffffff; border: 1px solid #ffffff;">__CTA_LABEL__</a>
                            </td>
                          </tr>
                        </table>
                        <!--<![endif]-->
                      </td>
                    </tr>
"""


# Bulletproof (Outlook-safe) button meant to sit inline inside `body_html`,
# between two paragraphs — unlike `_CTA_ROW` above, which only renders once,
# between the body and the footer. Colors are inverted (navy fill, white text)
# because it lands on the white body card instead of the navy footer row.
_CTA_BUTTON_INLINE = """<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin: 4px auto 20px; border-collapse: collapse;">
  <tr>
    <td align="center" style="padding: 0; margin: 0;">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="__CTA_URL__" style="height:46px;v-text-anchor:middle;width:280px;" arcsize="12%" stroke="f" fillcolor="#1f2c4d">
      <w:anchorlock/>
      <center style="color:#ffffff;font-family:arial,sans-serif;font-size:16px;font-weight:bold;">__CTA_LABEL__</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-- -->
      <a href="__CTA_URL__" target="_blank" style="display: inline-block; padding: 14px 32px; font-family: arial, 'helvetica neue', helvetica, sans-serif; font-size: 16px; font-weight: bold; color: #ffffff; text-decoration: none; border-radius: 6px; background-color: #1f2c4d; border: 1px solid #1f2c4d;">__CTA_LABEL__</a>
      <!--<![endif]-->
    </td>
  </tr>
</table>
"""


def email_cta_button(url: str, label: str) -> str:
    """A bulletproof (Outlook-safe) button usable inline within `body_html`.

    Use this when a CTA needs to sit mid-body (e.g. between two numbered
    steps) rather than in the single `cta=` slot of `render_branded_email`,
    which always renders once, after the last paragraph. Both `url` and
    `label` are escaped.
    """
    return (
        _CTA_BUTTON_INLINE
        .replace("__CTA_URL__", escape(url or ""))
        .replace("__CTA_LABEL__", escape(label or "Xem chi tiết"))
    )


def email_paragraph(text: str) -> str:
    """A single body paragraph styled to match the brand template.

    `text` may contain trusted inline HTML (e.g. `<strong>`); callers must
    escape any user-controlled value themselves before interpolating it in,
    the same convention `views_email.py` follows for ad-hoc admin emails.
    """
    return (
        '<p style="margin: 0 0 16px; -webkit-text-size-adjust: none; -ms-text-size-adjust: none; '
        "mso-line-height-rule: exactly; font-family: arial, 'helvetica neue', helvetica, sans-serif; "
        'line-height: 27px; color: #09132c; font-size: 16px; text-align: left;">'
        f"{text}</p>"
    )


def render_branded_email(*, title: str, body_html: str, cta: dict | None = None) -> str:
    """Wrap `body_html` in the shared VNUTour branded layout.

    `title` is escaped (it becomes the H1). `body_html` is inserted as-is —
    build it from `email_paragraph()` and escape any user-controlled value
    before interpolating it. `cta`, if given, is `{"url": str, "label": str}`
    and renders a bulletproof (Outlook-safe) button between the body and the
    footer; both `url` and `label` are escaped.
    """
    cta_row = ""
    if cta and cta.get("url"):
        cta_row = (
            _CTA_ROW
            .replace("__CTA_URL__", escape(cta["url"]))
            .replace("__CTA_LABEL__", escape(cta.get("label") or "Xem chi tiết"))
        )

    return (
        _LAYOUT
        .replace("__SUBJECT__", escape(title))
        .replace("__TITLE__", escape(title))
        .replace("__BODY__", body_html)
        .replace("__CTA_ROW__", cta_row)
        .replace("__HEADER_IMAGE_URL__", _HEADER_IMAGE_URL)
        .replace("__CREST_IMAGE_URL__", _CREST_IMAGE_URL)
        .replace("__LOGO_IMAGE_URL__", _LOGO_IMAGE_URL)
    )
