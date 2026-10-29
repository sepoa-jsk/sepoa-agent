package kr.co.sepoasoft.quote.web;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.env.Environment;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpStatus;
import org.springframework.mail.MailAuthenticationException;
import org.springframework.mail.MailException;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Component;

import jakarta.mail.MessagingException;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import kr.co.sepoasoft.quote.web.advice.ApiException;

/**
 * 견적서 메일 발송 — work_agent(app/integrations/mailer.py)와 같은 SMTP(AWS SES) 설정을 쓴다.
 *
 * <p>설정(apps/quote/.env): SMTP_HOST · SMTP_PORT · SMTP_USER · SMTP_PASSWORD · SMTP_USE_TLS · MAIL_FROM ·
 * MAIL_SENDER_LABEL · MAIL_ALLOWLIST · MAIL_DRY_RUN.
 * <ul>
 *   <li>보내는 주소는 MAIL_FROM(SES 에 인증된 시스템 주소) 하나다. 답장은 보낸 영업 담당자에게 가도록 Reply-To 를 그 사람 주소로 둔다.</li>
 *   <li>SMTP_USE_TLS=true 는 STARTTLS(587)를 뜻하고, 서버가 지원하지 않으면 평문으로 보내지 않고 중단한다(work_agent 와 같다).</li>
 *   <li>MAIL_DRY_RUN 은 따로 정하지 않으면 true — 실제로 보내지 않고 기록만 남긴다. 처음 켤 때 실수로 고객에게 나가지 않게.</li>
 *   <li>MAIL_ALLOWLIST 가 있으면 그 주소로만 보낸다(받는 사람 · 참조 모두).</li>
 * </ul>
 */
@Component
public class QuoteMailer {

    private static final Logger log = LoggerFactory.getLogger(QuoteMailer.class);
    private static final Pattern EMAIL = Pattern.compile("^[^@\\s,;]+@[^@\\s,;]+\\.[^@\\s,;]+$");

    private final Environment env;

    public QuoteMailer(Environment env) {
        this.env = env;
    }

    private String get(String key) {
        String v = env.getProperty(key);
        return v == null ? "" : v.trim();
    }

    public boolean dryRun() {
        return !"false".equalsIgnoreCase(get("MAIL_DRY_RUN"));
    }

    public List<String> allowlist() {
        return split(get("MAIL_ALLOWLIST"));
    }

    public boolean configured() {
        return !get("SMTP_HOST").isEmpty() && !get("MAIL_FROM").isEmpty();
    }

    /** 화면이 보여 줄 발송 설정 — 비밀번호 · 계정은 내보내지 않는다 */
    public Map<String, Object> info() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("configured", configured());
        m.put("dry_run", dryRun());
        m.put("allowlist", allowlist());
        m.put("from", get("MAIL_FROM"));
        return m;
    }

    /** 쉼표 · 세미콜론 · 줄바꿈으로 나눈 주소 목록 */
    public static List<String> split(String value) {
        List<String> out = new ArrayList<>();
        if (value == null) return out;
        for (String p : value.split("[,;\\s]+")) if (!p.isBlank()) out.add(p.trim());
        return out;
    }

    public static boolean validEmail(String s) {
        return s != null && EMAIL.matcher(s).matches();
    }

    /** 첨부 */
    public record Attachment(String name, byte[] data, String type) { }

    /**
     * 보낸다. 시험 모드면 보내지 않고 {@code dry_run=true} 를 돌려준다.
     *
     * @param replyTo 보낸 사람(로그인 사용자) 주소 — 답장이 이리로 온다
     * @param senderName 보낸 사람 이름 — 머리에 "세포아소프트 홍길동" 으로 표기
     */
    public Map<String, Object> send(List<String> to, List<String> cc, String subject, String body,
            List<Attachment> files, String replyTo, String senderName) {
        List<String> blocked = new ArrayList<>();
        List<String> allow = allowlist().stream().map(a -> a.toLowerCase(Locale.ROOT)).toList();
        if (!allow.isEmpty()) {
            for (String a : concat(to, cc)) if (!allow.contains(a.toLowerCase(Locale.ROOT))) blocked.add(a);
        }
        if (!blocked.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "MAIL_BLOCKED",
                    "발송 허용 목록(MAIL_ALLOWLIST)에 없는 주소입니다: " + String.join(", ", blocked));
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("to", to);
        out.put("cc", cc);
        out.put("subject", subject);
        out.put("attachments", files.stream().map(Attachment::name).toList());
        if (dryRun()) {
            log.info("[mail dry-run] to={} cc={} subject={} files={}", to, cc, subject, out.get("attachments"));
            out.put("dry_run", true);
            return out;
        }
        if (!configured()) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "MAIL_NOT_CONFIGURED", "메일 서버 설정(SMTP_HOST · MAIL_FROM)이 없습니다.");
        }
        JavaMailSenderImpl sender = new JavaMailSenderImpl();
        sender.setHost(get("SMTP_HOST"));
        sender.setPort(Integer.parseInt(get("SMTP_PORT").isEmpty() ? "587" : get("SMTP_PORT")));
        if (!get("SMTP_USER").isEmpty()) {
            sender.setUsername(get("SMTP_USER"));
            sender.setPassword(get("SMTP_PASSWORD"));
        }
        sender.setDefaultEncoding(StandardCharsets.UTF_8.name());
        Properties p = sender.getJavaMailProperties();
        p.put("mail.smtp.auth", String.valueOf(!get("SMTP_USER").isEmpty()));
        boolean tls = !"false".equalsIgnoreCase(get("SMTP_USE_TLS"));
        p.put("mail.smtp.starttls.enable", String.valueOf(tls));
        p.put("mail.smtp.starttls.required", String.valueOf(tls)); // STARTTLS 가 안 되면 평문으로 보내지 않는다
        p.put("mail.smtp.connectiontimeout", "20000");
        p.put("mail.smtp.timeout", "30000");
        p.put("mail.smtp.writetimeout", "30000");
        try {
            MimeMessage msg = sender.createMimeMessage();
            MimeMessageHelper h = new MimeMessageHelper(msg, true, StandardCharsets.UTF_8.name());
            String label = get("MAIL_SENDER_LABEL").isEmpty() ? "세포아소프트" : get("MAIL_SENDER_LABEL");
            h.setFrom(new InternetAddress(get("MAIL_FROM"), senderName == null || senderName.isBlank() ? label : label + " " + senderName,
                    StandardCharsets.UTF_8.name()));
            if (validEmail(replyTo)) h.setReplyTo(replyTo);
            h.setTo(to.toArray(String[]::new));
            if (!cc.isEmpty()) h.setCc(cc.toArray(String[]::new));
            h.setSubject(subject);
            h.setText(body, false);
            for (Attachment f : files) h.addAttachment(f.name(), new ByteArrayResource(f.data()), f.type());
            sender.send(msg);
            log.info("[mail] sent to={} cc={} subject={}", to, cc, subject);
            out.put("dry_run", false);
            return out;
        } catch (MailAuthenticationException e) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "MAIL_AUTH", "메일 서버 로그인에 실패했습니다. SMTP 계정을 확인하세요.");
        } catch (MailException | MessagingException | java.io.UnsupportedEncodingException e) {
            log.warn("[mail] failed: {}", e.getMessage());
            throw new ApiException(HttpStatus.BAD_GATEWAY, "MAIL_FAILED", "메일 발송에 실패했습니다: " + e.getMessage());
        }
    }

    private static List<String> concat(List<String> a, List<String> b) {
        List<String> out = new ArrayList<>(a);
        out.addAll(b);
        return out;
    }
}
