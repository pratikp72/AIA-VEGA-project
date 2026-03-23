/**
 * My Notifications – list of admin notifications.
 * Quiz reattempt notifications are clickable and redirect to Quiz Reattempt Requests page.
 */

import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Layouts } from "@strapi/strapi/admin";
import { Box, Typography, Flex, Loader, Badge } from "@strapi/design-system";
import { getFetchClient } from "@strapi/strapi/admin";

const QUIZ_REATTEMPT_TYPES = [
  "quiz_reattempt_requested",
  "quiz_reattempt_approved",
  "quiz_reattempt_rejected",
];

function formatDate(dateString) {
  if (!dateString) return "—";
  const d = new Date(dateString);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getTypeBadgeVariant(type) {
  if (QUIZ_REATTEMPT_TYPES.includes(type)) return "alternative";
  if (type === "feedback_submitted") return "success";
  if (type === "news_liked") return "warning";
  return "neutral";
}

export default function AdminNotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const { get } = getFetchClient();
    get("/modules-sidebar/admin-notifications?limit=100")
      .then(({ data }) => {
        if (cancelled || !isMounted.current) return;
        const list = data?.data ?? data ?? [];
        setNotifications(Array.isArray(list) ? list : []);
      })
      .catch((e) => {
        if (cancelled || !isMounted.current) return;
        setError(e?.message || "Failed to load notifications");
        setNotifications([]);
      })
      .finally(() => {
        if (isMounted.current) setLoading(false);
      });
    return () => {
      cancelled = true;
      isMounted.current = false;
    };
  }, []);

  const handleNotificationClick = (notification) => {
    const type = notification?.type || "";
    if (QUIZ_REATTEMPT_TYPES.includes(type)) {
      navigate("/plugins/quiz-reattempt-requests");
    }
  };

  const isQuizReattempt = (n) => QUIZ_REATTEMPT_TYPES.includes(n?.type || "");

  return (
    <Layouts.Root>
      <Layouts.Header
        title="My Notifications"
        subtitle={
          loading
            ? "Loading…"
            : `${notifications.length} notification${notifications.length === 1 ? "" : "s"}`
        }
      />
      <Layouts.Content>
        <Box paddingLeft={8} paddingRight={8} paddingTop={6} paddingBottom={8}>
          {error && (
            <Box padding={4} background="danger100" hasRadius marginBottom={4}>
              <Typography textColor="danger700">{error}</Typography>
            </Box>
          )}

          {loading ? (
            <Flex justifyContent="center" padding={8}>
              <Loader>Loading...</Loader>
            </Flex>
          ) : notifications.length === 0 ? (
            <Box padding={6} background="neutral100" hasRadius>
              <Typography textColor="neutral600">
                No notifications yet.
              </Typography>
            </Box>
          ) : (
            <Box
              background="neutral0"
              hasRadius
              shadow="tableShadow"
              padding={0}
              borderColor="neutral200"
              borderWidth="1px"
              borderStyle="solid"
            >
              {notifications.map((n) => {
                const clickable = isQuizReattempt(n);
                return (
                  <Box
                    key={n.id ?? n.documentId ?? n.createdAt + n.title}
                    padding={4}
                    borderColor="neutral200"
                    borderWidth="1px"
                    borderStyle="solid"
                    style={{
                      borderLeft: "none",
                      borderRight: "none",
                      borderTop: "none",
                      cursor: clickable ? "pointer" : "default",
                    }}
                    onClick={() => clickable && handleNotificationClick(n)}
                    as={clickable ? "button" : "div"}
                    type={clickable ? "button" : undefined}
                    textAlign="left"
                    background={clickable ? "neutral50" : undefined}
                    hasRadius={false}
                  >
                    <Flex
                      gap={2}
                      wrap="wrap"
                      alignItems="center"
                      marginBottom={1}
                    >
                      <Badge variant={getTypeBadgeVariant(n.type)}>
                        {n.type || "custom"}
                      </Badge>
                      <Typography variant="sigma" textColor="neutral700">
                        {formatDate(n.createdAt)}
                      </Typography>
                      {clickable && (
                        <Typography variant="pi" textColor="primary600">
                          Click to open Quiz Reattempt Requests →
                        </Typography>
                      )}
                    </Flex>
                    {n.meta &&
                      (n.meta.userId != null ||
                        n.meta.userName ||
                        n.meta.courseId != null ||
                        n.meta.courseTitle ||
                        n.meta.newsId != null ||
                        n.meta.newsTitle) && (
                        <Box marginTop={2}>
                          {(n.meta.userId != null || n.meta.userName) && (
                            <Typography variant="pi" textColor="primary700">
                             User: {n.meta.userName}
                            </Typography>
                          )}
                          {(n.meta.courseId != null || n.meta.courseTitle) && (
                            <Typography variant="pi" textColor="primary700">
                              <><br />Course: {n.meta.courseTitle}</>
                            </Typography>
                          )}
                          {n.meta.courseId == null &&
                            (n.meta.newsId != null || n.meta.newsTitle) && (
                              <Typography variant="pi" textColor="primary700">
                               <><br /> News: {n.meta.newsTitle}</>
                              </Typography>
                            )}
                        </Box>
                      )}
                  </Box>
                );
              })}
            </Box>
          )}
        </Box>
      </Layouts.Content>
    </Layouts.Root>
  );
}
